from __future__ import annotations

import hashlib
import os
import re
from typing import Any, Literal

from openai import OpenAI
from pydantic import BaseModel, Field

from .field_catalog import FIELD_SPECS


ALLOWED_CATEGORIES = {
    "identity", "classification", "offer", "icp", "communication", "faqs",
    "locations", "hours", "contacts", "marketing", "legal",
}

class EvidenceReference(BaseModel):
    document_id: str
    original_text: str


class NormalizedField(BaseModel):
    key: str
    category: str
    value: str | float | bool | list[str] | None = None
    origin: Literal["extracted", "inferred"]
    confidence: Literal["high", "medium", "low"] | None = None
    status: Literal["extracted", "inferred", "not_found", "pending_validation"]
    contradiction: bool = False
    alternatives: list[str] = Field(default_factory=list)
    evidence: list[EvidenceReference] = Field(default_factory=list)
    required_for_base: bool = False


class NormalizedContext(BaseModel):
    fields: list[NormalizedField]


def _doc_catalog(documents: list[dict]) -> tuple[list[dict], str]:
    catalog = []
    blocks = []
    budget = 120_000
    for index, document in enumerate(documents):
        if budget <= 0:
            break
        text = str(document.get("extractedText") or "").strip()
        if not text:
            continue
        excerpt = text[: min(12_000, budget)]
        budget -= len(excerpt)
        evidence_id = f"DOC_{index + 1}"
        catalog.append({"id": evidence_id, **document})
        blocks.append(f"[{evidence_id}] URL: {document.get('url')}\nTITLE: {document.get('title', '')}\nTEXT:\n{excerpt}")
    return catalog, "\n\n".join(blocks)


def _fallback(documents: list[dict]) -> list[dict]:
    first = next((item for item in documents if item.get("extractedText")), None)
    title = (first or {}).get("title") or None
    description = ((first or {}).get("extractedText") or "")[:700] or None
    fields = []
    for key, spec in FIELD_SPECS.items():
        value = title if key == "commercial_name" else description if key == "business_description" else None
        evidence = []
        if value and first:
            evidence.append({
                "sourceId": first.get("sourceId"),
                "url": first.get("url"),
                "sourceType": first.get("sourceType", "website"),
                "originalText": str(first.get("extractedText") or "")[:1200],
                "capturedAt": first.get("capturedAt"),
                "contentHash": first.get("contentHash"),
            })
        value = _fallback_faqs(documents) if key == "faqs" else value
        has_value = bool(value)
        fields.append({
            "key": key,
            "category": spec.category,
            "value": value,
            "origin": "inferred" if key == "faqs" and has_value else "extracted",
            "confidence": "medium" if key == "faqs" and has_value else "low" if has_value else None,
            "status": "inferred" if key == "faqs" and has_value else "pending_validation" if has_value else "not_found",
            "contradiction": False,
            "alternatives": [],
            "evidence": _first_document_evidence(first) if key == "faqs" and has_value else evidence,
            "requiredForBase": spec.required_for_base or key == "faqs",
        })
    return fields


def _normalized_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _verified_snippet(document: dict, candidate: str) -> str | None:
    original = _normalized_whitespace(candidate)
    haystack = _normalized_whitespace(str(document.get("extractedText") or ""))
    if not original or len(original) < 3 or original.casefold() not in haystack.casefold():
        return None
    return original[:4000]


def _first_document_evidence(document: dict | None) -> list[dict]:
    if not document:
        return []
    original_text = str(document.get("extractedText") or "").strip()[:1200]
    if not original_text:
        return []
    return [{
        "sourceId": document.get("sourceId"),
        "url": document.get("url"),
        "sourceType": document.get("sourceType", "website"),
        "originalText": original_text,
        "capturedAt": document.get("capturedAt"),
        "contentHash": document.get("contentHash"),
    }]


def _faq_item_text(item: Any) -> str:
    if isinstance(item, dict):
        question = str(item.get("question") or item.get("pregunta") or "").strip()
        answer = str(item.get("answer") or item.get("respuesta") or "").strip()
        if question and answer:
            return f"{question} Respuesta: {answer}"
        return question or answer
    return str(item or "").strip()


def _has_answered_faq_list(value: object, min_items: int = 3) -> bool:
    if isinstance(value, list):
        answered = [_faq_item_text(item) for item in value]
        return len([item for item in answered if "respuesta:" in item.casefold() and len(item) >= 24]) >= min_items
    if isinstance(value, str):
        return len([line for line in value.splitlines() if "respuesta:" in line.casefold() and len(line.strip()) >= 24]) >= min_items
    return False


def _fallback_faqs(documents: list[dict], fields: list[dict] | None = None) -> list[str]:
    text = "\n".join(str(item.get("extractedText") or "") for item in documents)
    lower_text = text.lower()
    by_key = {field.get("key"): field.get("value") for field in fields or []}
    faqs: list[str] = []

    def clean(value: object) -> str:
        if isinstance(value, list):
            return ", ".join(str(item).strip() for item in value if str(item).strip())
        return str(value or "").strip()

    def sentence_from_context(key: str, fallback: str) -> str:
        value = clean(by_key.get(key))
        if value:
            return value[:320]
        return fallback

    def add(question: str, answer: str) -> None:
        item = f"{question} Respuesta: {answer.strip()}"
        if item not in faqs and len(faqs) < 20:
            faqs.append(item)

    services = by_key.get("primary_offers") or by_key.get("services") or by_key.get("products")
    if services or any(word in lower_text for word in ["servicio", "producto", "solución", "consultoría", "automatización", "consultoria", "automatizacion"]):
        add("¿Qué servicios o productos ofrece la empresa?", sentence_from_context("primary_offers", "La empresa ofrece los servicios o productos descritos en sus canales públicos. Para una recomendación precisa, el cliente puede pedir orientación según su necesidad."))
    add("¿Cómo funciona el proceso de atención o implementación?", "El proceso debe explicarse de forma simple: entender la necesidad del cliente, confirmar la información relevante y guiarlo al siguiente paso comercial definido por el negocio.")
    if any(word in lower_text for word in ["whatsapp", "contacto", "llamada", "formulario", "agenda"]):
        add("¿Por qué canal puedo contactar o avanzar con el negocio?", "El cliente puede avanzar por los canales públicos detectados, como WhatsApp, formulario, llamada, agenda o redes sociales, según lo que el negocio tenga publicado.")
    else:
        add("¿Cómo puedo contactar al negocio?", "El bot debe ofrecer el canal de contacto publicado por el negocio o, si no hay uno claro, indicar que puede dejar sus datos para recibir orientación.")
    if any(word in lower_text for word in ["precio", "costo", "cotiza", "plan", "paquete", "$", "usd"]):
        add("¿Cuál es el costo o cómo se cotiza el servicio?", "El costo depende de la información comercial publicada y del caso del cliente. Si no hay precio confirmado, el bot debe evitar inventar valores y guiar a una cotización o asesoría.")
    if any(word in lower_text for word in ["horario", "lunes", "martes", "sábado", "domingo"]):
        add("¿Cuáles son los horarios de atención?", "Los horarios visibles se deben usar solo como contexto público. La agenda real se confirma en el bloque operativo correspondiente.")
    if any(word in lower_text for word in ["quito", "guayaquil", "ecuador", "colombia", "méxico", "ubicación", "sede"]):
        add("¿Dónde atienden o en qué zonas trabajan?", "La cobertura o ubicación debe responderse con la información pública detectada, sin confirmar sedes finales hasta el bloque operativo de citas.")
    add("¿Qué beneficios obtiene el cliente al contratar este negocio?", sentence_from_context("benefits", "El cliente recibe los beneficios comunicados públicamente por el negocio, como atención, asesoría, rapidez, confianza o mejores resultados según aplique."))
    add("¿Qué información necesita el cliente antes de avanzar?", "El cliente suele necesitar entender la oferta, requisitos, condiciones generales, canales de contacto y el siguiente paso para recibir atención o agendar.")

    return faqs[:20]


def _normalize_faqs(value: object, documents: list[dict], fields: list[dict] | None = None) -> list[str]:
    fallback = _fallback_faqs(documents, fields)
    fallback_answers = {
        item.split(" Respuesta:", 1)[0].strip(): item.split(" Respuesta:", 1)[1].strip()
        for item in fallback
        if " Respuesta:" in item
    }
    raw_items = value if isinstance(value, list) else str(value or "").splitlines()
    normalized: list[str] = []
    for raw in raw_items:
        text = _faq_item_text(raw)
        if not text:
            continue
        if "respuesta:" in text.casefold():
            question, answer = re.split(r"respuesta\s*:", text, maxsplit=1, flags=re.IGNORECASE)
            question = question.strip()
            answer = answer.strip()
        else:
            question = text.strip()
            answer = fallback_answers.get(question) or "Respuesta sugerida desde el contexto público: orientar al cliente con la información detectada y llevarlo al siguiente paso comercial sin inventar datos no confirmados."
        item = f"{question} Respuesta: {answer}"
        if item not in normalized:
            normalized.append(item)
        if len(normalized) >= 20:
            break
    return normalized if _has_answered_faq_list(normalized) else fallback


def _ensure_candidate_faqs(fields: list[dict], documents: list[dict]) -> None:
    faq_field = next((field for field in fields if field.get("key") == "faqs"), None)
    if not faq_field:
        return
    if _has_answered_faq_list(faq_field.get("value")):
        faq_field["value"] = _normalize_faqs(faq_field.get("value"), documents, fields)
        return
    generated = _normalize_faqs(faq_field.get("value"), documents, fields)
    if not generated:
        return
    first = next((item for item in documents if item.get("extractedText")), None)
    faq_field.update({
        "value": generated,
        "origin": "inferred",
        "confidence": "medium",
        "status": "inferred",
        "contradiction": False,
        "alternatives": faq_field.get("alternatives") or [],
        "evidence": faq_field.get("evidence") or _first_document_evidence(first),
        "requiredForBase": True,
    })


def normalize_context(documents: list[dict]) -> tuple[list[dict], str | None, str]:
    catalog, prompt_documents = _doc_catalog(documents)
    model = os.getenv("BRE_NORMALIZATION_MODEL", "gpt-5.4")
    input_hash = hashlib.sha256(prompt_documents.encode("utf-8")).hexdigest()
    if not os.getenv("OPENAI_API_KEY") or not prompt_documents:
        return _fallback(documents), "OPENAI_API_KEY is not configured; deterministic fallback used", input_hash

    instructions = """
You normalize public business information for a base-context onboarding.
Return only fields with useful public evidence or a justified inference, plus all eleven dynamic
fields even when they are not found. Valid keys and categories are supplied below.
Represent complex or repeated information as a concise list of strings; do not return nested objects.
For faqs, every item must include both the question and the answer in this exact style:
¿Pregunta frecuente? Respuesta: respuesta breve basada on public context. Never return only questions.
For faqs, extract as many useful items as the evidence allows, with a hard maximum of 20.
You must try to produce at least 3 useful FAQs whenever public context allows it.
Every factual extracted value must cite one or more provided DOC ids and include a short exact quote
copied from that document. Never invent or paraphrase evidence quotes.
Use origin=inferred for hypotheses, including ICP and any classification not literally stated.
Every inferred field must use status=inferred even at high confidence.
Extracted high-confidence literal values may use status=extracted. Medium/low extracted values use
status=pending_validation. Contradictions must preserve alternatives and contradiction=true.
Include all eleven dynamic fields. Set required_for_base=true for commercial_name,
business_description, industry, country, value_proposition, primary_offers, benefits,
ideal_customer_profile and communication_tone. Set it for general_restrictions only when the
business appears to require a missing restriction. Set it for faqs when fewer than three useful
candidate FAQs can be produced. Missing optional fields may be not_found with required_for_base=false.
Locations and visible hours are context only, never confirmed branches, schedules or appointment data.
Do not produce objectives, appointments, meetings, calendars, gates, filters, legal consent decisions,
emoji preferences, templates, or pipeline matching configuration.
Valid field catalog:
""".strip() + "\n" + "\n".join(
        f"- {key}: {spec.category}" for key, spec in FIELD_SPECS.items()
    )
    try:
        client = OpenAI()
        response = client.responses.parse(
            model=model,
            input=[
                {"role": "system", "content": instructions},
                {"role": "user", "content": prompt_documents},
            ],
            text_format=NormalizedContext,
        )
    except Exception as exc:
        return _fallback(documents), f"OpenAI normalization failed; deterministic fallback used: {str(exc)[:1200]}", input_hash
    parsed = response.output_parsed
    if not parsed:
        return _fallback(documents), "OpenAI returned no structured output; deterministic fallback used", input_hash
    by_id = {item["id"]: item for item in catalog}
    fields = []
    seen = set()
    for item in parsed.fields:
        spec = FIELD_SPECS.get(item.key)
        if not spec or item.key in seen or item.category not in ALLOWED_CATEGORIES or item.category != spec.category:
            continue
        seen.add(item.key)
        evidence = []
        for evidence_ref in item.evidence:
            document = by_id.get(evidence_ref.document_id)
            if not document:
                continue
            original_text = _verified_snippet(document, evidence_ref.original_text)
            if not original_text:
                continue
            evidence.append({
                "sourceId": document.get("sourceId"),
                "url": document.get("url"),
                "sourceType": document.get("sourceType", "other"),
                "originalText": original_text,
                "capturedAt": document.get("capturedAt"),
                "contentHash": document.get("contentHash"),
            })
        inferred = item.origin == "inferred" or (item.value is not None and item.status != "not_found" and not evidence)
        status = "inferred" if inferred else item.status
        if not inferred and item.confidence != "high" and status == "extracted":
            status = "pending_validation"
        fields.append({
            "key": item.key,
            "category": item.category,
            "value": item.value,
            "origin": "inferred" if inferred else "extracted",
            "confidence": item.confidence,
            "status": status,
            "contradiction": item.contradiction,
            "alternatives": [{"value": alternative} for alternative in item.alternatives],
            "evidence": evidence,
            "requiredForBase": spec.required_for_base or (
                item.key in {"general_restrictions", "faqs"} and item.required_for_base
            ),
        })
    for missing_key, spec in FIELD_SPECS.items():
        if missing_key in seen:
            continue
        fields.append({
            "key": missing_key,
            "category": spec.category,
            "value": None,
            "origin": "extracted",
            "confidence": None,
            "status": "not_found",
            "contradiction": False,
            "alternatives": [],
            "evidence": [],
            "requiredForBase": spec.required_for_base or missing_key == "faqs",
        })
    _ensure_candidate_faqs(fields, documents)
    return fields, None, input_hash
