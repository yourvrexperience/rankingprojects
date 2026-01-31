# prompt_builder.py
from __future__ import annotations
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
import json

SUPPORTED_LANGS = {"en", "es", "ca"}

def normalize_lang(lang: Optional[str]) -> str:
    if not lang:
        return "en"
    lang = str(lang).strip().lower()
    return lang if lang in SUPPORTED_LANGS else "en"


@dataclass(frozen=True)
class PromptTexts:
    rubric_heading: str
    canvas_heading: str
    summary_heading: str
    script_heading: str

    evaluate_instructions: str
    compare_instructions_intro: str
    find_category_instructions: str


TEXTS: Dict[str, PromptTexts] = {
    "en": PromptTexts(
        rubric_heading="RUBRIC (PDF)",
        canvas_heading="BUSINESS CANVAS",
        summary_heading="EXECUTIVE SUMMARY",
        script_heading="VIDEO PITCH SCRIPT",
        evaluate_instructions=(
            "INSTRUCTIONS:\n"
            "1. Apply each rubric criterion in a structured way.\n"
            "2. Assign a score per criterion.\n"
            "3. Return a FINAL SCORE (0–100).\n"
            "4. Include strengths, weaknesses, and actionable recommendations.\n"
            "5. Write the evaluation in English."
        ),
        compare_instructions_intro=(
            "INSTRUCTIONS:\n"
            "1. Return one item in results[] for EACH compared project.\n"
            "2. 'title' must match exactly one of the provided titles.\n"
            "3. 'match' must be an integer 0–100 (higher = more similar).\n"
            "4. 'differences' and 'collaboration' must be lists of strings.\n"
            "5. Write the content in English."
        ),
        find_category_instructions=(
            "INSTRUCTIONS:\n"
            "1. Choose the single best matching category from the provided list.\n"
            "2. category_id must match one provided numeric id exactly.\n"
            "3. category_name must match one provided name exactly.\n"
            "4. Write the explanation and summary in English."
        ),
    ),
    "es": PromptTexts(
        rubric_heading="RÚBRICA (PDF)",
        canvas_heading="BUSINESS CANVAS",
        summary_heading="RESUMEN EJECUTIVO",
        script_heading="GUIÓN VIDEO PITCH",
        evaluate_instructions=(
            "INSTRUCCIONES:\n"
            "1. Aplica cada criterio de la rúbrica de forma estructurada.\n"
            "2. Asigna una puntuación por criterio.\n"
            "3. Devuelve un SCORE FINAL (0–100).\n"
            "4. Incluye fortalezas, debilidades y recomendaciones.\n"
            "5. Escribe la evaluación en español."
        ),
        compare_instructions_intro=(
            "INSTRUCCIONES:\n"
            "1. Devuelve un elemento en results[] por CADA proyecto de la lista.\n"
            "2. 'title' debe coincidir exactamente con uno de los títulos proporcionados.\n"
            "3. 'match' es un número entero 0–100 (más alto = más similar).\n"
            "4. 'differences' y 'collaboration' deben ser listas de strings.\n"
            "5. Escribe el contenido en español."
        ),
        find_category_instructions=(
            "INSTRUCCIONES:\n"
            "1. Elige la única categoría que mejor encaja de la lista proporcionada.\n"
            "2. category_id debe coincidir exactamente con un id numérico proporcionado.\n"
            "3. category_name debe coincidir exactamente con un nombre proporcionado.\n"
            "4. Escribe la explicación y el resumen en español."
        ),
    ),
    "ca": PromptTexts(
        rubric_heading="RÚBRICA (PDF)",
        canvas_heading="BUSINESS CANVAS",
        summary_heading="RESUM EXECUTIU",
        script_heading="GUIÓ VIDEO PITCH",
        evaluate_instructions=(
            "INSTRUCCIONS:\n"
            "1. Aplica cada criteri de la rúbrica de manera estructurada.\n"
            "2. Assigna una puntuació per criteri.\n"
            "3. Retorna un SCORE FINAL (0–100).\n"
            "4. Inclou fortaleses, debilitats i recomanacions accionables.\n"
            "5. Escriu l’avaluació en català."
        ),
        compare_instructions_intro=(
            "INSTRUCCIONS:\n"
            "1. Retorna un element a results[] per a CADA projecte de la llista.\n"
            "2. 'title' ha de coincidir exactament amb un dels títols proporcionats.\n"
            "3. 'match' ha de ser un enter 0–100 (més alt = més similar).\n"
            "4. 'differences' i 'collaboration' han de ser llistes de strings.\n"
            "5. Escriu el contingut en català."
        ),
        find_category_instructions=(
            "INSTRUCCIONS:\n"
            "1. Tria l’única categoria que millor encaixa de la llista proporcionada.\n"
            "2. category_id ha de coincidir exactament amb un id numèric proporcionat.\n"
            "3. category_name ha de coincidir exactament amb un nom proporcionat.\n"
            "4. Escriu l’explicació i el resum en català."
        ),
    ),
}


def build_evaluate_query(
    lang: str,
    user_prompt: str,
    rubric_text: str,
    canvas_text: str,
    summary_text: str,
    script_text: str,
) -> str:
    L = TEXTS[normalize_lang(lang)]
    user_prompt = (user_prompt or "").strip()

    return "\n".join([
        user_prompt,
        "",
        f"--- {L.rubric_heading} ---",
        rubric_text or "",
        "",
        f"--- {L.canvas_heading} ---",
        canvas_text or "",
        "",
        f"--- {L.summary_heading} ---",
        summary_text or "",
        "",
        f"--- {L.script_heading} ---",
        script_text or "",
        "",
        L.evaluate_instructions
    ]).strip()


def build_compare_query(
    lang: str,
    user_prompt: str,
    original_title: str,
    original_canvas_text: str,
    original_summary_text: str,
    other_projects_blocks: List[str],
    other_titles: List[str],
) -> str:
    L = TEXTS[normalize_lang(lang)]
    user_prompt = (user_prompt or "").strip()

    titles_json = json.dumps(other_titles, ensure_ascii=False)

    return "\n".join([
        user_prompt,
        "",
        f"--- ORIGINAL PROJECT: {original_title} - {L.canvas_heading} ---",
        original_canvas_text or "",
        "",
        f"--- ORIGINAL PROJECT: {original_title} - {L.summary_heading} ---",
        original_summary_text or "",
        "",
        "--- OTHER PROJECTS TO COMPARE ---",
        "\n".join(other_projects_blocks).strip(),
        "",
        L.compare_instructions_intro,
        f"Allowed titles JSON:\n{titles_json}"
    ]).strip()


def build_find_category_query(
    lang: str,
    user_prompt: str,
    canvas_text: str,
    summary_text: str,
    script_text: str,
    categories_hint: Optional[str] = None,
) -> str:
    L = TEXTS[normalize_lang(lang)]
    user_prompt = (user_prompt or "").strip()

    parts = [
        user_prompt,
        "",
        f"--- {L.canvas_heading} ---",
        canvas_text or "",
        "",
        f"--- {L.summary_heading} ---",
        summary_text or "",
        "",
        f"--- {L.script_heading} ---",
        script_text or "",
        "",
    ]
    if categories_hint:
        parts += ["--- CATEGORIES ---", categories_hint, ""]

    parts += [L.find_category_instructions]
    return "\n".join(parts).strip()

def get_prompt_headings(lang: Optional[str]) -> Dict[str, str]:
    """
    Returns localized headings used in prompts.
    Safe accessor for TEXTS[lang].

    Example return:
    {
        "canvas": "BUSINESS CANVAS",
        "summary": "EXECUTIVE SUMMARY",
        "rubric": "RUBRIC (PDF)",
        "script": "VIDEO PITCH SCRIPT"
    }
    """
    L = TEXTS[normalize_lang(lang)]
    return {
        "canvas": L.canvas_heading,
        "summary": L.summary_heading,
        "rubric": L.rubric_heading,
        "script": L.script_heading,
    }
