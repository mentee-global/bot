import json

from app.agents.mentee.tools.career import analyze_career_path


def test_analyze_career_path_known_role_returns_gap() -> None:
    raw = analyze_career_path(
        target_role="data scientist",
        current_skills=["python", "sql"],
    )
    result = json.loads(raw)
    assert result["status"] == "ok"
    assert result["matched_role"] is True
    assert "statistics" in result["gap"]
    assert result["priority"][0]["tier"] == "critical"


def test_analyze_career_path_missing_skills_returns_insufficient_context() -> None:
    raw = analyze_career_path(target_role="data scientist", current_skills=[])
    result = json.loads(raw)
    assert result["status"] == "insufficient_context"
    assert "current_skills" in result["missing_fields"]


def test_analyze_career_path_missing_target_returns_insufficient_context() -> None:
    raw = analyze_career_path(target_role="", current_skills=["python"])
    result = json.loads(raw)
    assert result["status"] == "insufficient_context"
    assert "target_role" in result["missing_fields"]


def test_analyze_career_path_unknown_role_falls_back_to_generic_template() -> None:
    raw = analyze_career_path(
        target_role="professional glassblower",
        current_skills=["patience"],
    )
    result = json.loads(raw)
    assert result["status"] == "ok"
    assert result["matched_role"] is False
    # Generic template always includes a field / portfolio line
    assert any("portfolio" in g or "field" in g for g in result["gap"])


def test_analyze_career_path_with_hours_estimates_weeks() -> None:
    raw = analyze_career_path(
        target_role="ml engineer",
        current_skills=["python"],
        constraints={"hours_per_week": "10"},
    )
    result = json.loads(raw)
    assert result["estimated_weeks"] is not None
    assert result["estimated_weeks"] >= 1
