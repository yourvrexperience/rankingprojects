from flask import Flask, request, jsonify
from flask_cors import CORS
import pymysql
from fastapi import FastAPI
from pydantic import BaseModel
import openai
import os
import json
import bcrypt
import jwt
import datetime
from functools import wraps
import pdfplumber
import aiohttp
import io
from pydantic import BaseModel, Field
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI
from langchain_core.prompts.prompt import PromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from typing import List, Optional
from prompt_builder import (
    normalize_lang,
    build_evaluate_query,
    build_compare_query,
    build_find_category_query,
    get_prompt_headings
)

JWT_SECRET = os.getenv("JWT_SECRET")  # set in env in production
JWT_ALG = "HS256"
JWT_EXPIRE_HOURS = 240
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET missing")
    
JWT_SECRET_BYTES = JWT_SECRET.encode("utf-8")

openai.api_key = os.getenv("OPENAI_API_KEY")
apikey_openrouter = os.getenv("OPENROUTER_API_KEY")

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": ["http://127.0.0.1:5500", "http://localhost:5500", "http://localhost:8080", "http://127.0.0.1:8080"]}})

# Database configuration
db_config = {
    'host': 'localhost',
    'user': 'root',
    'password': '',
    'database': 'test'
}

name_model = "gpt-5-mini"

# ############################################
# DATA STRUCTURES
# ############################################
# MODEL SELECTION
model_llm = ChatOpenAI(model=name_model, temperature=1)
# model_llm = ChatOllama(model="gpt-oss:latest", base_url="URL_OR_TUNNEL_TO_YOUR_LOCAL_SERVER", temperature=0.7, num_ctx=8192) # SLOW MODEL WITH JSON OUTPUT
# model_llm = ChatOllama(model="qwen2.5:7b", base_url="URL_OR_TUNNEL_TO_YOUR_LOCAL_SERVER", temperature=0.7, num_ctx=8192)  # FAST MODEL WITH JSON OUTPUT
# model_llm = ChatOpenAI( openai_api_key=apikey_openrouter, openai_api_base='https://openrouter.ai/api/v1', model_name=name_model, model_kwargs={}, default_headers={ "HTTP-Referer": "https://www.workflowsimulator.com", "X-Title": "Ranking Projects"});

# Langchain class format for "/evaluate"
class EvaluationResult(BaseModel):
    score: int = Field(description="Final score from 0 to 100.")
    evaluation: str = Field(description="Short structured evaluation text.")
    strengths: list[str] = Field(description="List of strengths.")
    weaknesses: list[str] = Field(description="List of weaknesses.")
    recommendations: list[str] = Field(description="List of actionable recommendations.")

# Langchain format prompt for "/evaluate"
evaluation_parser = JsonOutputParser(pydantic_object=EvaluationResult)
evaluation_prompt = PromptTemplate(
    template="\n{format_instructions}\n\n{query}\n",
    input_variables=["query"],
    partial_variables={"format_instructions": evaluation_parser.get_format_instructions()},
)
evaluation_chain = evaluation_prompt | model_llm | evaluation_parser

# Langchain class format for "/compareprojects"
class ProjectComparisonItem(BaseModel):
    title: str = Field(description="Title of the compared project.")
    match: int = Field(description="Similarity score 0-100.")
    similarities: str = Field(description="Summary of main similarities.")
    differences: List[str] = Field(description="List of key differences.")
    collaboration: List[str] = Field(description="List of collaboration ideas.")

class CompareProjectsResult(BaseModel):
    results: List[ProjectComparisonItem] = Field(description="Comparison results for all other projects.")

# Langchain format prompt for "/compareprojects"
compare_parser = JsonOutputParser(pydantic_object=CompareProjectsResult)
compare_prompt = PromptTemplate(
    template="\n{format_instructions}\n\n{query}\n",
    input_variables=["query"],
    partial_variables={"format_instructions": compare_parser.get_format_instructions()},
)
compare_chain = compare_prompt | model_llm | compare_parser

# Langchain class format for "/findoutcategory"
class FindCategoryResult(BaseModel):
    category_id: str = Field(description="The selected category number id (must match one of the provided category numeric ids exactly).")
    category_name: str = Field(description="The selected category name id (must match one of the provided category name ids exactly).")
    category_description: str = Field(description="A short explanation of why this category fits.")
    project_short_description: str = Field(description="A one-paragraph summary of the project.")

# Langchain format prompt for "/compareprojects"
find_category_parser = JsonOutputParser(pydantic_object=FindCategoryResult)
find_category_prompt = PromptTemplate(
    template="\n{format_instructions}\n\n{query}\n",
    input_variables=["query"],
    partial_variables={"format_instructions": find_category_parser.get_format_instructions()},
)
find_category_chain = find_category_prompt | model_llm | find_category_parser


# ############################################
# HELPER FUNCTIONS
# ############################################

def get_user_session_by_email(email: str):
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT session FROM users WHERE LOWER(email)=LOWER(%s) LIMIT 1", (email,))
            row = cursor.fetchone()
            if not row:
                return None
            raw = row[0]
            if raw is None or raw == "":
                return {}
            # raw can be dict (JSON column), bytes, or str depending on driver/column type
            if isinstance(raw, (dict, list)):
                return raw
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", errors="ignore")
            if isinstance(raw, str):
                try:
                    return json.loads(raw)
                except json.JSONDecodeError:
                    return {}
            return {}
    finally:
        connection.close()


def update_user_session_by_email(email: str, session_obj):
    """
    Stores session_obj as JSON in users.session.
    Works with JSON column or TEXT column.
    """
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            # Always store as JSON string; JSON column will accept it too
            session_json = json.dumps(session_obj or {}, ensure_ascii=False)
            cursor.execute(
                "UPDATE users SET session=%s WHERE LOWER(email)=LOWER(%s)",
                (session_json, email)
            )
        connection.commit()
        return True
    finally:
        connection.close()

async def extract_pdf_text_from_url(url):
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            pdf_bytes = await resp.read()

    text = ""
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"

    return text
    
def update_user_name_by_email(email: str, new_name: str):
    email = (email or "").strip().lower()
    new_name = (new_name or "").strip()

    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE users SET name=%s WHERE LOWER(email)=LOWER(%s)",
                (new_name, email)
            )
        connection.commit()
        return True
    finally:
        connection.close()

def get_project_by_owner_email(owner_email: str):
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT id, email, category_id, title, description, authors, link,
                       pitch, canvas, summary, script, detail, score, evaluation, conversation, likes, relationships_local, relationships_global
                FROM projects
                WHERE LOWER(email) = LOWER(%s)
                ORDER BY id DESC
                LIMIT 1
            """, (owner_email,))
            row = cursor.fetchone()
            return row
    finally:
        connection.close()

import pymysql

def update_project_by_owner_email(owner_email: str, fields: dict):
    owner_email = (owner_email or "").strip().lower()

    # Normalize fields
    category_id = fields.get("category_id", None)
    if category_id is not None:
        category_id = str(category_id).strip()
        if category_id == "":
            category_id = None  # treat empty as null
            
    # Normalize fields + provide defaults
    title = (fields.get("title") or "").strip()
    description = (fields.get("description") or "").strip()
    authors = (fields.get("authors") or "").strip()
    link = (fields.get("link") or "").strip()
    script = (fields.get("script") or "").strip()
    pitch = (fields.get("pitch") or "").strip()
    canvas = (fields.get("canvas") or "").strip()
    summary = (fields.get("summary") or "").strip()
    detail = fields.get("detail") or ""

    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            # 1) Find an existing project for this owner (latest)
            cursor.execute(
                "SELECT id FROM projects WHERE LOWER(email)=LOWER(%s) ORDER BY id DESC LIMIT 1",
                (owner_email,)
            )
            row = cursor.fetchone()

            if row:
                project_id = row[0]
                cursor.execute(
                    """
                    UPDATE projects
                    SET category_id=%s,
                        title=%s,
                        description=%s,
                        authors=%s,
                        pitch=%s,
                        canvas=%s,
                        summary=%s,
                        detail=%s,
                        link=%s,
                        script=%s
                    WHERE id=%s
                    """,
                    (category_id, title, description, authors, pitch, canvas, summary, detail, link, script, project_id)
                )
                created = False
            else:
                cursor.execute(
                    """
                    INSERT INTO projects (email, category_id, title, description, authors, link, pitch, canvas, summary, detail, script)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (owner_email, category_id, title, description, authors, link, pitch, canvas, summary, detail, script)
                )
                project_id = cursor.lastrowid
                created = True

        connection.commit()
        return {"ok": True, "created": created, "project_id": project_id}
    finally:
        connection.close()

def delete_project_by_owner_email(owner_email: str):
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM projects WHERE LOWER(email)=LOWER(%s)", (owner_email,))
        connection.commit()
        return True
    finally:
        connection.close()

def delete_user_and_projects(owner_email: str):
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM projects WHERE LOWER(email)=LOWER(%s)", (owner_email,))
            cursor.execute("DELETE FROM users WHERE LOWER(email)=LOWER(%s)", (owner_email,))
        connection.commit()
        return True
    finally:
        connection.close()

def project_row_to_dict(row):
    if not row:
        return None
    # print("project_row_to_dict::likes={}".format(row[14]))
    return {
        "id": row[0],
        "email": row[1],
        "category_id": row[2],
        "title": row[3],
        "description": row[4],
        "authors": row[5],
        "link": row[6],
        "pitch": row[7],
        "canvas": row[8],
        "summary": row[9],
        "script": row[10],
        "detail": row[11],
        "score": row[12],
        "evaluation": row[13],
        "conversation": row[14],
        "likes": row[15],        
        "local": row[16], 
        "global": row[17], 
    }

def get_user_by_email(email: str):
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT id, name, email, password, validated FROM users WHERE email=%s", (email,))
            row = cursor.fetchone()
            return row  # (id, email, password) or None
    finally:
        connection.close()

def create_user(username: str, email: str, password: str):
    """
    Creates a user in table `users` with columns:
      id (auto), name (varchar(10)), email (varchar(255)), password (varchar(255)), created_at (default)
    Returns:
      (ok: bool, error: str | None)
    """
    username = (username or "").strip()
    email = (email or "").strip().lower()
    password = password or ""

    # Basic validation (backend-side)
    if not email:
        return False, "Email is required."
    if len(password) < 8:
        return False, "Password must be at least 8 characters long."

    pw_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            # Optional: check uniqueness by email (recommended)
            cursor.execute("SELECT id FROM users WHERE email=%s LIMIT 1", (email,))
            if cursor.fetchone():
                return False, "Email already exists."

            sql = """
                INSERT INTO users (name, email, password)
                VALUES (%s, %s, %s)
            """
            cursor.execute(sql, (username, email, pw_hash))
            connection.commit()
            
            # Debug confirmation
            new_id = cursor.lastrowid
            # print(f"[REGISTER] Inserted user id={new_id}, email={email}, rowcount={cursor.rowcount}")

            return {"ok": True, "id": new_id}
    finally:
        connection.close()


def issue_token(user_id: int, email: str):
    now = datetime.datetime.utcnow()
    payload = {
        "sub": str(user_id),
        "email": email,
        "iat": now,
        "exp": now + datetime.timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET_BYTES, algorithm=JWT_ALG)

def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return jsonify({"ok": False, "error": "Missing Bearer token"}), 401

        token = auth.split(" ", 1)[1].strip()
        
        try:
            payload = jwt.decode(token, JWT_SECRET_BYTES, algorithms=[JWT_ALG])
            print ("require_auth::payload={}".format(payload))
        except jwt.ExpiredSignatureError:
            return jsonify({"ok": False, "error": "Token expired"}), 401
        except Exception as e:
            print("JWT decode error:", repr(e))
            return jsonify({"ok": False, "error": f"Invalid token: {str(e)}"}), 401

        request.user = payload  # attach user info
        return fn(*args, **kwargs)
    return wrapper

def get_project_owner_email(project_id: int):
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT email FROM projects WHERE id=%s", (project_id,))
            row = cursor.fetchone()
            return row[0] if row else None
    finally:
        connection.close()

def update_project_evaluation(project_id, score, evaluation):
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            sql = """
                UPDATE projects
                SET score = %s, evaluation = %s
                WHERE id = %s
            """
            cursor.execute(sql, (score, evaluation, project_id))
        connection.commit()
        return True
    finally:
        connection.close()

def update_project_relationships_local(project_id, relationships):
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            sql = """
                UPDATE projects
                SET relationships_local = %s
                WHERE id = %s
            """
            cursor.execute(sql, (relationships, project_id))
        connection.commit()
        return True
    finally:
        connection.close()

def update_project_relationships_global(project_id, relationships):
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            sql = """
                UPDATE projects
                SET relationships_global = %s
                WHERE id = %s
            """
            cursor.execute(sql, (relationships, project_id))
        connection.commit()
        return True
    finally:
        connection.close()

def get_project_conversation(project_id):
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT conversation FROM projects WHERE id=%s", (project_id,))
            row = cursor.fetchone()
            if row and row[0]:
                return json.loads(row[0])
            return []
    finally:
        connection.close()

def update_project_conversation(project_id, conversation):
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            sql = "UPDATE projects SET conversation=%s WHERE id=%s"
            cursor.execute(sql, (json.dumps(conversation), project_id))
        connection.commit()
        return True
    finally:
        connection.close()

def remove_user_by_id(users, user_id):
    """Remove user by ID and return new list"""
    return [user for user in users if user["user"] != user_id]

def get_project_likes(project_id):
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT likes FROM projects WHERE id=%s", (project_id,))
            row = cursor.fetchone()
            if row and row[0]:
                return json.loads(row[0])
            return []
    finally:
        connection.close()

def update_project_likes(project_id, likes):
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            sql = "UPDATE projects SET likes=%s WHERE id=%s"
            cursor.execute(sql, (json.dumps(likes), project_id))
        connection.commit()
        return True
    finally:
        connection.close()

def get_user_name(user_id):
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT name FROM users WHERE id=%s", (user_id,))
            row = cursor.fetchone()
            return row[0] if row else None
    finally:
        connection.close()
        
# Function to fetch all categories from the database
def get_all_categories():
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            sql = "SELECT * FROM categories"
            cursor.execute(sql)
            result = cursor.fetchall()
            return result
    finally:
        connection.close()

# Function to fetch all projects from the database
def get_all_projects():
    connection = pymysql.connect(**db_config)
    try:
        with connection.cursor() as cursor:
            sql = "SELECT * FROM projects"
            cursor.execute(sql)
            result = cursor.fetchall()
            return result
    finally:
        connection.close()

def parse_likes_data(likes_data):
    """Parse likes data from database (bytes, string, or None) to Python list"""
    if likes_data is None:
        return []
    
    if isinstance(likes_data, bytes):
        try:
            return json.loads(likes_data.decode('utf-8'))
        except (json.JSONDecodeError, UnicodeDecodeError):
            # Try latin-1 if utf-8 fails
            try:
                return json.loads(likes_data.decode('latin-1'))
            except:
                return []
    
    if isinstance(likes_data, str):
        try:
            return json.loads(likes_data)
        except json.JSONDecodeError:
            return []
    
    return []

# ############################################
# ENDPOINTS
# ############################################

# Endpoint LOGIN USER
@app.route("/rankingprojects/auth/login", methods=["POST"])
def login():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    row = get_user_by_email(email)
    if not row:
        return jsonify({"ok": False, "error": "Invalid credentials"}), 401

    user_id, user_name, user_email, pw_hash, validated = row
    if not bcrypt.checkpw(password.encode("utf-8"), pw_hash.encode("utf-8")):
        return jsonify({"ok": False, "error": "Invalid credentials"}), 401

    if validated == 0:
        return jsonify({"ok": False, "error": "Not Validated Yet"}), 401

    token = issue_token(user_id, user_email)
    return jsonify({"ok": True, "token": token, "email": user_email, "name": user_name})

# Endpoint REGISTER USER
@app.route("/rankingprojects/auth/register", methods=["POST"])
def register():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password or len(password) < 8:
        return jsonify({"ok": False, "error": "Invalid email or password"}), 400

    existing = get_user_by_email(email)
    if existing:
        return jsonify({"ok": False, "error": "Email already exists"}), 409

    create_user(email, email, password)
    return jsonify({"ok": True})

# Endpoint GET SESSION
@app.route("/rankingprojects/me/session", methods=["GET"])
@require_auth
def get_my_session():
    owner_email = request.user.get("email")
    if not owner_email:
        return jsonify({"ok": False, "error": "Invalid token payload (missing email)."}), 401

    try:
        sess = get_user_session_by_email(owner_email)
        if sess is None:
            return jsonify({"ok": False, "error": "User not found"}), 404
        return jsonify({"ok": True, "session": sess})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# Endpoint UPDATE SESSIONS
@app.route("/rankingprojects/me/session", methods=["PUT"])
@require_auth
def put_my_session():
    owner_email = request.user.get("email")
    if not owner_email:
        return jsonify({"ok": False, "error": "Invalid token payload (missing email)."}), 401

    data = request.get_json() or {}
    session_obj = data.get("session", None)

    if not isinstance(session_obj, (dict, list)) and session_obj is not None:
        return jsonify({"ok": False, "error": "session must be an object (or null)"}), 400

    # Optional: size limit (avoid giant rows)
    try:
        raw_size = len(json.dumps(session_obj or {}))
        if raw_size > 50_000:
            return jsonify({"ok": False, "error": "session too large"}), 413
    except Exception:
        pass

    try:
        update_user_session_by_email(owner_email, session_obj or {})
        return jsonify({"ok": True, "session": session_obj or {}})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# Endpoint RENAME USER
@app.route("/rankingprojects/me/name", methods=["PUT"])
@require_auth
def update_my_name():
    data = request.get_json() or {}
    new_name = (data.get("name") or "").strip()

    if not new_name:
        return jsonify({"ok": False, "error": "Name is required."}), 400

    # Optional: enforce max length (your comment says varchar(10), but your DB might be bigger)
    if len(new_name) > 30:
        return jsonify({"ok": False, "error": "Name is too long (max 30 chars)."}), 400

    owner_email = request.user.get("email")
    if not owner_email:
        return jsonify({"ok": False, "error": "Invalid token payload (missing email)."}), 401

    try:
        update_user_name_by_email(owner_email, new_name)
        return jsonify({"ok": True, "name": new_name})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# Endpoint to list all projects
@app.route('/rankingprojects/projects', methods=['GET'])
def list_projects():
    projects = get_all_projects()
    projects_list = []
    for project in projects:
        project_dict = {
            'id': project[0],
            'email': project[1],
            'category_id': project[3],
            'title': project[4],
            'description': project[5],
            'authors': project[6],
            'link': project[7],
            'pitch': project[8],
            'canvas': project[9],
            'summary': project[10],
            'script': project[11],
            'detail': project[12],
            'score': project[13],
            'evaluation': project[14],
            'conversation': parse_likes_data(project[15]),
            'likes': parse_likes_data(project[16]),
            'local': parse_likes_data(project[17]),
            'global': parse_likes_data(project[18])
        }
        projects_list.append(project_dict)
    return jsonify(projects_list)

# Endpoint to list all categories
@app.route('/rankingprojects/categories', methods=['GET'])
def list_categories():
    categories = get_all_categories()
    categories_list = []
    for category in categories:
        category_dict = {
            'uid': category[0],
            'id': category[1],
            'color': category[2],
            'labelShort': category[3],
            'labelActiveShort': category[4],
            'labelLong': category[5],
            'rubric': category[6],
            'traits': category[7]
        }
        categories_list.append(category_dict)
    return jsonify(categories_list)

# Endpoint to EVALUATE
@app.route("/rankingprojects/evaluate", methods=["POST"])
async def evaluate_project():
    # Parse the JSON data from the request body
    data = request.get_json()
    project_id = data.get("project")
    prompt = data.get("prompt")
    rubric = data.get("rubric")
    canvas = data.get("canvas")
    summary = data.get("summary")
    script = data.get("script")

    rubric_text = await extract_pdf_text_from_url(rubric)
    canvas_text = await extract_pdf_text_from_url(canvas)
    summary_text = await extract_pdf_text_from_url(summary)

    lang = normalize_lang(data.get("lang"))

    query = build_evaluate_query(
        lang=lang,
        user_prompt=prompt,
        rubric_text=rubric_text,
        canvas_text=canvas_text,
        summary_text=summary_text,
        script_text=script,
    )

    if not project_id or not query:
        return jsonify({"ok": False, "error": "Missing project or prompt"}), 400

    try:
        # LangChain returns a parsed python dict validated by Pydantic
        result = evaluation_chain.invoke({"query": query})
        # result is a dict like: {"score":..., "evaluation":..., ...}
    except Exception as e:
        return jsonify({"ok": False, "error": f"LLM parsing failed: {str(e)}"}), 502

    # Ensure score is int and in range
    try:
        score = int(result.get("score"))
        if score < 0: score = 0
        if score > 100: score = 100
        result["score"] = score
    except Exception:
        result["score"] = 0

    # Store evaluation as JSON string in DB (same as you do today)
    evaluation_json = json.dumps(result, ensure_ascii=False)
    update_project_evaluation(project_id, result["score"], evaluation_json)
    
    return evaluation_json

# Endpoint to COMPARE PROJECTS
@app.route("/rankingprojects/compareprojects", methods=["POST"])
async def compare_projects():
    # Parse the JSON data from the request body
    data = request.get_json()
    project_id = data.get("project")
    project_title = data.get("title")
    is_global = data.get("is_global")
    prompt = data.get("prompt")
    canvas = data.get("canvas")
    summary = data.get("summary")
    other_projects = data.get("other_projects", [])
    lang = normalize_lang(data.get("lang"))

    # Validate required fields
    if not project_id or not prompt or not other_projects:
        return jsonify({"ok": False, "error": "Missing required fields: project, prompt, or other_projects"}), 400

    original_canvas_text = await extract_pdf_text_from_url(canvas)
    original_summary_text = await extract_pdf_text_from_url(summary)

    # Build the section for other projects
    other_projects_blocks = []
    other_titles = []

    for idx, project in enumerate(other_projects, 1):
        project_title_other = project.get("title", f"Project {idx}")
        project_canvas = project.get("canvas")
        project_summary = project.get("summary")        
        other_titles.append(project_title_other)

        # Extract text from other projects' documents
        canvas_text = await extract_pdf_text_from_url(project_canvas) if project_canvas else "No disponible"
        summary_text = await extract_pdf_text_from_url(project_summary) if project_summary else "No disponible"

        headings = get_prompt_headings(lang)

        canvas_h = headings["canvas"]
        summary_h = headings["summary"]

        block = "\n".join([
            f"--- PROJECT {idx}: {project_title_other} - {canvas_h} ---",
            canvas_text,
            "",
            f"--- PROJECT {idx}: {project_title_other} - {summary_h} ---",
            summary_text,
            ""
        ]).strip()
        other_projects_blocks.append(block)

    # Build final prompt
    final_query = build_compare_query(
        lang=lang,
        user_prompt=prompt,
        original_title=project_title,
        original_canvas_text=original_canvas_text,
        original_summary_text=original_summary_text,
        other_projects_blocks=other_projects_blocks,
        other_titles=other_titles,
    )

    if not project_id or not final_query:
        return jsonify({"ok": False, "error": "Missing project or prompt"}), 400

    try:
        parsed = compare_chain.invoke({"query": final_query})
        # parsed is a dict: {"results":[{...}, ...]}
    except Exception as e:
        return jsonify({"ok": False, "error": f"LLM parsing failed: {str(e)}"}), 502

    # Normalize match to int 0..100
    results = parsed.get("results") if isinstance(parsed, dict) else None
    if not isinstance(results, list):
        return jsonify({"ok": False, "error": "Unexpected model output format"}), 502

    for item in results:
        try:
            m = int(item.get("match"))
        except Exception:
            m = 0
        item["match"] = max(0, min(100, m))

        # Ensure arrays exist
        if not isinstance(item.get("differences"), list):
            item["differences"] = []
        if not isinstance(item.get("collaboration"), list):
            item["collaboration"] = []

        if not isinstance(item.get("similarities"), str):
            item["similarities"] = str(item.get("similarities") or "")            

    relationships_json = json.dumps(results, ensure_ascii=False)
    
    if is_global:
        update_project_relationships_global(project_id, relationships_json)
    else:
        update_project_relationships_local(project_id, relationships_json)

    return results

# Endpoint to FIND OUT CATEGORY OF THE PROJECT
@app.route("/rankingprojects/findoutcategory", methods=["POST"])
async def findoutcategory_project():
    # Parse the JSON data from the request body
    data = request.get_json()
    prompt = data.get("prompt")
    canvas = data.get("canvas")
    summary = data.get("summary")
    script = data.get("script")
    lang = normalize_lang(data.get("lang"))

    canvas_text = await extract_pdf_text_from_url(canvas)
    summary_text = await extract_pdf_text_from_url(summary)

    final_query = build_find_category_query(
        lang=lang,
        user_prompt=prompt,
        canvas_text=canvas_text,
        summary_text=summary_text,
        script_text=script
    )

    if not final_query:
        return jsonify({"ok": False, "error": "Missing prompt"}), 400

    try:
        result = find_category_chain.invoke({"query": final_query})
    except Exception as e:
        return jsonify({"ok": False, "error": f"LLM parsing failed: {str(e)}"}), 502

    category_id = result.get("category_id", None)
    category_name = result.get("category_name", None)
    category_description = result.get("category_description", None)
    project_short_description = result.get("project_short_description", None)

    return result

# Endpoint to GET MY PROJECT
@app.route("/rankingprojects/my/project", methods=["GET"])
@require_auth
def my_project_get():
    owner_email = request.user.get("email")
    row = get_project_by_owner_email(owner_email)
    if not row:
        return jsonify({"ok": False, "error": "No project found for this user."}), 404
    return jsonify(project_row_to_dict(row))

# Endpoint to SAVE MY PROJECT
@app.route("/rankingprojects/my/project", methods=["PUT"])
@require_auth
def my_project_update():
    owner_email = request.user.get("email")
    data = request.get_json() or {}

    # Minimal validation
    category_id = data.get("category_id", None)
    
    title = (data.get("title") or "").strip()
    description = (data.get("description") or "").strip()
    authors = (data.get("authors") or "").strip()

    fields = {
        "category_id": category_id,
        "title": title,
        "description": description,
        "authors": authors,
        "link": (data.get("link") or "").strip(),
        "script": (data.get("script") or "").strip(),
        "pitch": (data.get("pitch") or "").strip(),
        "canvas": (data.get("canvas") or "").strip(),
        "summary": (data.get("summary") or "").strip(),
        "detail": (data.get("detail") or ""),
    }

    update_project_by_owner_email(owner_email, fields)

    # Return updated project
    updated = get_project_by_owner_email(owner_email)
    return jsonify({"ok": True, "project": project_row_to_dict(updated)})

# Endpoint to DELETE MY PROJECT
@app.route("/rankingprojects/my/project", methods=["DELETE"])
@require_auth
def my_project_delete():
    owner_email = request.user.get("email")
    existing = get_project_by_owner_email(owner_email)
    if not existing:
        return jsonify({"ok": False, "error": "No project found to delete."}), 404

    delete_project_by_owner_email(owner_email)
    return jsonify({"ok": True})

# Endpoint to DELETE ACCOUNT
@app.route("/rankingprojects/me", methods=["DELETE"])
@require_auth
def delete_me():
    owner_email = request.user.get("email")
    delete_user_and_projects(owner_email)
    return jsonify({"ok": True})

# Endpoint to ADD CONVERSATION ENTRY
@app.route("/rankingprojects/addconversationentry", methods=["POST"])
def add_conversation_entry():
    data = request.get_json() or {}
    user = data.get("user")
    project = data.get("project")
    text = data.get("text")

    if not all([user is not None, project, text]):
        return jsonify({"ok": False, "error": "Missing parameters"}), 400

    try:
        name = get_user_name(user) or "Unknown"
        conversation = get_project_conversation(project)
        new_entry = {"user": user, "name": name, "text": text}
        conversation.append(new_entry)
        success = update_project_conversation(project, conversation)
        return jsonify(success)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# Endpoint to GET CONVERSATION
@app.route("/rankingprojects/getconversation", methods=["GET"])
def get_conversation():
    project = request.args.get("project")
    if not project:
        return jsonify({"ok": False, "error": "Missing project parameter"}), 400

    try:
        conversation = get_project_conversation(project)
        return jsonify(conversation)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# Endpoint to ADD LIKES
@app.route("/rankingprojects/addlike", methods=["POST"])
def add_like():
    data = request.get_json() or {}
    user = data.get("user")
    project = data.get("project")

    if not all([user is not None, project]):
        return jsonify({"ok": False, "error": "Missing parameters"}), 400

    try:
        name = get_user_name(user) or "Unknown"
        likes = get_project_likes(project)
        new_entry = {"user": user, "name": name}
        likes.append(new_entry)
        success = update_project_likes(project, likes)
        return jsonify(success)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# Endpoint to REMOVE LIKE
@app.route("/rankingprojects/removelike", methods=["POST"])
def remove_like():
    data = request.get_json() or {}
    user = data.get("user")
    project = data.get("project")

    if not all([user is not None, project]):
        return jsonify({"ok": False, "error": "Missing parameters"}), 400

    try:
        likes = get_project_likes(project)
        updated_likes = remove_user_by_id(likes, user)
        success = update_project_likes(project, updated_likes)
        return jsonify(success)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# Endpoint to GET LIKES
@app.route("/rankingprojects/getlikes", methods=["GET"])
def get_likes():
    project = request.args.get("project")
    if not project:
        return jsonify({"ok": False, "error": "Missing project parameter"}), 400

    try:
        likes = get_project_likes(project)
        return jsonify(likes)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/rankingprojects/hello')
def hello():
    return "Hello, World!"

if __name__ == '__main__':
    app.run(debug=True)

