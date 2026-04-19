"""Local career-advice tool.

Rubric-based rather than freeform: given a target role and current skills, we
enumerate the core skills for that role, diff against what the mentee has, and
hand back a prioritized skill-gap plan. The model composes the plan into prose
the mentee can act on.

Intentionally deterministic and dependency-free — no external API, no model
call inside the tool. If the role isn't in our map, we fall back to a generic
template and flag it so the model can add caveats.
"""

from __future__ import annotations

from app.agents.mentee.tools.schemas import insufficient_context, ok

_CORE_SKILLS: dict[str, list[str]] = {
    "data scientist": [
        "python",
        "sql",
        "statistics",
        "machine learning",
        "data visualization",
        "experiment design",
    ],
    "data analyst": [
        "sql",
        "excel",
        "python",
        "statistics",
        "data visualization",
        "business communication",
    ],
    "ml engineer": [
        "python",
        "pytorch",
        "machine learning",
        "mlops",
        "linux",
        "system design",
    ],
    "software engineer": [
        "data structures",
        "algorithms",
        "git",
        "testing",
        "system design",
        "one production language",
    ],
    "frontend engineer": [
        "javascript",
        "typescript",
        "react",
        "html",
        "css",
        "accessibility",
    ],
    "backend engineer": [
        "python or go or java",
        "sql",
        "rest apis",
        "testing",
        "caching",
        "system design",
    ],
    "product manager": [
        "user research",
        "roadmapping",
        "prioritization frameworks",
        "analytics",
        "written communication",
        "stakeholder alignment",
    ],
    "ux designer": [
        "user research",
        "wireframing",
        "prototyping",
        "figma",
        "interaction design",
        "accessibility",
    ],
    "researcher": [
        "research methodology",
        "academic writing",
        "literature review",
        "statistics",
        "presenting",
        "grant writing",
    ],
}


def _normalize(s: str) -> str:
    return s.strip().lower()


def analyze_career_path(
    target_role: str,
    current_skills: list[str],
    constraints: dict[str, str] | None = None,
) -> str:
    """Return a structured skill-gap plan for the given target role.

    Returns `insufficient_context` JSON if the inputs are empty. Always returns
    a JSON string; the model reads it and composes the human-readable reply.
    """
    if not target_role or not target_role.strip():
        return insufficient_context(
            ["target_role"],
            "Ask the mentee what role they want to reach "
            "(e.g. 'data scientist', 'product manager').",
        )
    if not current_skills:
        return insufficient_context(
            ["current_skills"],
            "Ask the mentee what they already know today — even rough bullets are fine.",
        )

    role_key = _normalize(target_role)
    known = {_normalize(s) for s in current_skills}

    core = _CORE_SKILLS.get(role_key)
    if core is None:
        # Best-effort fuzzy match: try substring fit, else generic template.
        matches = [k for k in _CORE_SKILLS if k in role_key or role_key in k]
        if matches:
            core = _CORE_SKILLS[matches[0]]
            role_key = matches[0]
        else:
            core = [
                "foundations of the field",
                "one production-quality portfolio project",
                "communication + storytelling",
                "domain knowledge",
            ]

    have = [s for s in core if any(s in k or k in s for k in known)]
    gap = [s for s in core if s not in have]

    priority: list[dict[str, str]] = []
    for i, skill in enumerate(gap):
        tier = "critical" if i < 2 else ("important" if i < 4 else "nice_to_have")
        priority.append({"skill": skill, "tier": tier})

    hours_per_week = None
    deadline_months = None
    if constraints:
        if "hours_per_week" in constraints:
            try:
                hours_per_week = int(constraints["hours_per_week"])
            except (ValueError, TypeError):
                hours_per_week = None
        if "deadline_months" in constraints:
            try:
                deadline_months = int(constraints["deadline_months"])
            except (ValueError, TypeError):
                deadline_months = None

    # Rough estimate: ~60 hours to reach working proficiency per critical skill.
    estimated_hours = 60 * len(gap)
    estimated_weeks = (
        max(1, estimated_hours // hours_per_week)
        if hours_per_week and hours_per_week > 0
        else None
    )

    return ok(
        {
            "target_role": role_key,
            "matched_role": role_key in _CORE_SKILLS,
            "have": have,
            "gap": gap,
            "priority": priority,
            "estimated_hours": estimated_hours,
            "estimated_weeks": estimated_weeks,
            "deadline_months": deadline_months,
            "note": (
                "Use 'priority' to recommend the next two skills to focus on first. "
                "Mention 'estimated_weeks' only if the mentee shared hours_per_week."
            ),
        }
    )
