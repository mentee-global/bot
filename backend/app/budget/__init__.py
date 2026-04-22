"""Per-user credits + global spend ceiling for OpenAI / Perplexity usage.

Every chat turn debits the actor's `UserQuota` row and adds a `MessageUsage` row
per model call. Global monthly spend is rolled up in the singleton
`GlobalBudgetState`. All pricing, caps, thresholds, and defaults live in the
singleton `BudgetConfig` row so the admin can edit them from the panel.
"""
