from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FieldSpec:
    category: str
    required_for_base: bool = False


FIELD_SPECS: dict[str, FieldSpec] = {
    # Identity
    "commercial_name": FieldSpec("identity", True),
    "legal_name": FieldSpec("identity"),
    "business_description": FieldSpec("identity", True),
    "business_summary": FieldSpec("identity"),
    "history_trajectory": FieldSpec("identity"),
    "mission": FieldSpec("identity"),
    "vision": FieldSpec("identity"),
    "purpose": FieldSpec("identity"),
    "slogan": FieldSpec("identity"),
    "country": FieldSpec("identity", True),
    "primary_city_zone": FieldSpec("identity"),
    "coverage_scope": FieldSpec("identity"),
    "primary_language": FieldSpec("identity"),
    # Commercial classification
    "industry": FieldSpec("classification", True),
    "subindustry": FieldSpec("classification"),
    "business_category": FieldSpec("classification"),
    "business_type": FieldSpec("classification"),
    "market_segment": FieldSpec("classification"),
    "target_customer_type": FieldSpec("classification"),
    # Offer
    "primary_offers": FieldSpec("offer", True),
    "services": FieldSpec("offer"),
    "products": FieldSpec("offer"),
    "offer_categories": FieldSpec("offer"),
    "plans_packages_memberships": FieldSpec("offer"),
    "benefits": FieldSpec("offer", True),
    "differentiators": FieldSpec("offer"),
    "value_proposition": FieldSpec("offer", True),
    "offer_features": FieldSpec("offer"),
    "guarantees": FieldSpec("offer"),
    "general_restrictions": FieldSpec("offer"),
    "requirements": FieldSpec("offer"),
    "commercial_conditions": FieldSpec("offer"),
    "promotions": FieldSpec("offer"),
    "discounts": FieldSpec("offer"),
    "bonuses_incentives": FieldSpec("offer"),
    # Inferred ICP
    "ideal_customer_profile": FieldSpec("icp", True),
    "customer_entity_type": FieldSpec("icp"),
    "customer_needs": FieldSpec("icp"),
    "customer_pains": FieldSpec("icp"),
    "purchase_motivations": FieldSpec("icp"),
    "probable_objections": FieldSpec("icp"),
    "customer_urgency": FieldSpec("icp"),
    "education_required": FieldSpec("icp"),
    "human_advisory_required": FieldSpec("icp"),
    # Communication
    "communication_tone": FieldSpec("communication", True),
    "formality_level": FieldSpec("communication"),
    "communication_style": FieldSpec("communication"),
    "frequent_words": FieldSpec("communication"),
    "recurring_sales_phrases": FieldSpec("communication"),
    "emoji_usage_visible": FieldSpec("communication"),
    "language_complexity": FieldSpec("communication"),
    "customer_closeness": FieldSpec("communication"),
    "sales_style": FieldSpec("communication"),
    # Candidate FAQs
    "faqs": FieldSpec("faqs"),
    "visible_faqs": FieldSpec("faqs"),
    "common_customer_questions": FieldSpec("faqs"),
    "commercial_objections": FieldSpec("faqs"),
    "pre_advance_information": FieldSpec("faqs"),
    "repeated_topics": FieldSpec("faqs"),
    "frequently_explained_conditions": FieldSpec("faqs"),
    "public_answers": FieldSpec("faqs"),
    # Possible locations, never final branches
    "possible_locations": FieldSpec("locations"),
    "possible_agencies": FieldSpec("locations"),
    "possible_branches": FieldSpec("locations"),
    "visible_addresses": FieldSpec("locations"),
    "visible_cities": FieldSpec("locations"),
    "visible_sectors": FieldSpec("locations"),
    "location_hours": FieldSpec("locations"),
    "google_maps_links": FieldSpec("locations"),
    "location_references": FieldSpec("locations"),
    # Visible hours, never appointment availability
    "visible_hours": FieldSpec("hours"),
    "service_days": FieldSpec("hours"),
    "hours_by_location": FieldSpec("hours"),
    "special_hours": FieldSpec("hours"),
    "visible_non_working_days": FieldSpec("hours"),
    # Public contacts and channels
    "phones": FieldSpec("contacts"),
    "whatsapp": FieldSpec("contacts"),
    "emails": FieldSpec("contacts"),
    "contact_forms": FieldSpec("contacts"),
    "contact_links": FieldSpec("contacts"),
    "calls_to_action": FieldSpec("contacts"),
    "official_social_networks": FieldSpec("contacts"),
    "public_booking_links": FieldSpec("contacts"),
    "primary_conversion_channel": FieldSpec("contacts"),
    # Marketing
    "published_content_types": FieldSpec("marketing"),
    "promotion_types": FieldSpec("marketing"),
    "most_promoted_offers": FieldSpec("marketing"),
    "frequent_topics": FieldSpec("marketing"),
    "campaign_style": FieldSpec("marketing"),
    "social_proof": FieldSpec("marketing"),
    "testimonials": FieldSpec("marketing"),
    "reviews": FieldSpec("marketing"),
    "success_cases": FieldSpec("marketing"),
    "certifications_endorsements": FieldSpec("marketing"),
    "mentioned_brands_partners_clients": FieldSpec("marketing"),
    # Visible legal context
    "privacy_policy": FieldSpec("legal"),
    "terms_conditions": FieldSpec("legal"),
    "legal_notices": FieldSpec("legal"),
    "data_processing_text": FieldSpec("legal"),
    "applicable_legal_country": FieldSpec("legal"),
    "personal_data_forms": FieldSpec("legal"),
    "visible_consent_texts": FieldSpec("legal"),
}


DYNAMIC_FIELD_KEYS = {
    "commercial_name",
    "business_description",
    "industry",
    "country",
    "value_proposition",
    "primary_offers",
    "benefits",
    "general_restrictions",
    "ideal_customer_profile",
    "communication_tone",
    "faqs",
}

