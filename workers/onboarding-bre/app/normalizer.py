from __future__ import annotations

import hashlib
import os
import re
from typing import Literal

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


def _has_meaningful_list(value: object, min_items: int = 3) -> bool:
    if isinstance(value, list):
        return len([item for item in value if str(item).strip()]) >= min_items
    if isinstance(value, str):
        return len([line for line in value.splitlines() if line.strip()]) >= min_items
    return False


def _fallback_faqs(documents: list[dict], fields: list[dict] | None = None) -> list[str]:
    text = "\n".join(str(item.get("extractedText") or "") for item in documents).lower()
    by_key = {field.get("key"): field.get("value") for field in fields or []}
    questions: list[str] = []

    def add(question: str) -> None:
        if question not in questions and len(questions) < 5:
            questions.append(question)

    services = by_key.get("primary_offers") or by_key.get("services") or by_key.get("products")
    if services or any(word in text for word in ["servicio", "producto", "solución", "consultoría", "automatización"]):
        add("¿Qué servicios o productos ofrece la empresa?")
    add("¿Cómo funciona el proceso de atención o implementación?")
    if any(word in text for word in ["whatsapp", "contacto", "llamada", "formulario", "agenda"]):
        add("¿Por qué canal puedo contactar o avanzar con el negocio?")
    else:
        add("¿Cómo puedo contactar al negocio?")
    if any(word in text for word in ["precio", "costo", "cotiza", "plan", "paquete", "$", "usd"]):
        add("¿Cuál es el costo o cómo se cotiza el servicio?")
    if any(word in text for word in ["horario", "lunes", "martes", "sábado", "domingo"]):
        add("¿Cuáles son los horarios de atención?")
    if any(word in text for word in ["quito", "guayaquil", "ecuador", "colombia", "méxico", "ubicación", "sede"]):
        add("¿Dónde atienden o en qué zonas trabajan?")
    add("¿Qué beneficios obtiene el cliente al contratar este negocio?")
    add("¿Qué información necesita el cliente antes de avanzar?")

    return questions[:5]


def _ensure_candidate_faqs(fields: list[dict], documents: list[dict]) -> None:
    faq_field = next((field for field in fields if field.get("key") == "faqs"), None)
    if not faq_field or _has_meaningful_list(faq_field.get("value")):
        return
    generated = _fallback_faqs(documents, fields)
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
