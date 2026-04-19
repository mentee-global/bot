from app.agents.mentee.prompts import SYSTEM_PROMPT


def test_system_prompt_defines_scope() -> None:
    # Scope covered
    for topic in ("scholarship", "study-abroad", "career"):
        assert topic in SYSTEM_PROMPT.lower(), f"missing scope topic: {topic}"


def test_system_prompt_includes_refusal_language() -> None:
    text = SYSTEM_PROMPT.lower()
    assert "politics" in text
    assert "medical" in text
    assert "legal" in text
    assert "outside" in text  # polite redirect clause


def test_system_prompt_forbids_fabrication() -> None:
    text = SYSTEM_PROMPT.lower()
    assert "never fabricate" in text or "never invent" in text
    assert "url" in text  # URL-fabrication specifically called out


def test_system_prompt_mandates_web_search_usage() -> None:
    text = SYSTEM_PROMPT.lower()
    assert "web_search" in text
    assert "field" in text and "country" in text  # filter requirements


def test_system_prompt_includes_ethical_limits() -> None:
    text = SYSTEM_PROMPT.lower()
    assert "promise" in text  # no promises about outcomes
    assert "sensitive" in text  # no sensitive data requests
