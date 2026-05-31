"""Structured-extraction schema for CVs / resumes.

Fed to the processor's `extract()` as JSON Schema via
`ResumeSchema.model_json_schema()`. Kept deliberately close to the fields a
mentoring bot actually personalizes on. Used in plan Phase 2.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class Education(BaseModel):
    degree: str = Field(description="Degree type (e.g. B.S., M.S., Ph.D.)")
    institution: str = Field(description="Name of the educational institution")
    field_of_study: str | None = Field(None, description="Field of study or major")
    graduation_date: str | None = Field(None, description="Graduation date or year")
    gpa: str | None = Field(None, description="GPA if mentioned")


class WorkExperience(BaseModel):
    company: str = Field(description="Company or organization name")
    position: str = Field(description="Job title or position")
    start_date: str | None = Field(None, description="Start date")
    end_date: str | None = Field(None, description="End date, or 'Present' if current")
    description: str | None = Field(
        None, description="Key responsibilities or accomplishments"
    )


class ResumeSchema(BaseModel):
    name: str = Field(description="Full name of the candidate")
    email: str | None = Field(None, description="Email address")
    phone: str | None = Field(None, description="Phone number")
    location: str | None = Field(None, description="Location or address")
    education: list[Education] = Field(
        default_factory=list, description="Educational qualifications"
    )
    work_experience: list[WorkExperience] = Field(
        default_factory=list, description="Work experience entries"
    )
    skills: list[str] = Field(
        default_factory=list,
        description="Skills, programming languages, or technical competencies",
    )
    certifications: list[str] | None = Field(
        None, description="Certifications or licenses"
    )
    languages: list[str] | None = Field(None, description="Languages spoken")
    summary: str | None = Field(None, description="Professional summary or objective")
