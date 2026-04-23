import type { User } from "#/features/auth/data/auth.types";

export interface MeCreditsInfo {
	remaining: number;
	used: number;
	total: number;
	resets_at: string;
	unlimited: boolean;
}

export interface MeAgentState {
	perplexity_degraded: boolean;
	hard_stopped: boolean;
}

export interface MeResponse {
	user: User;
	credits: MeCreditsInfo;
	agent_state: MeAgentState;
}

export interface BudgetConfig {
	default_monthly_credits: number;
	credit_usd_value_micros: number;
	pricing_openai_input_per_mtok_micros: number;
	pricing_openai_output_per_mtok_micros: number;
	pricing_perplexity_input_per_mtok_micros: number;
	pricing_perplexity_output_per_mtok_micros: number;
	pricing_perplexity_request_fee_micros: number;
	pricing_web_search_per_call_micros: number;
	updated_at: string;
}

export type BudgetConfigPatch = Partial<Omit<BudgetConfig, "updated_at">>;

export interface GlobalSpend {
	period_start: string;
	openai_spend_micros: number;
	perplexity_spend_micros: number;
	web_search_spend_micros: number;
	total_spend_micros: number;
	perplexity_degraded: boolean;
	hard_stopped: boolean;
	perplexity_degrade_reason: string | null;
	perplexity_degraded_at: string | null;
	hard_stop_reason: string | null;
	hard_stopped_at: string | null;
}

export interface ProviderSpend {
	provider: string;
	available: boolean;
	period_start: string | null;
	spend_micros: number;
	currency: string;
	reason: string | null;
	dashboard_url: string | null;
	fetched_at: string | null;
	ledger_spend_micros: number | null;
}

export interface ProvidersResponse {
	openai: ProviderSpend;
	perplexity: ProviderSpend;
}

export interface UserQuota {
	user_id: string;
	credits_remaining: number;
	credits_used_period: number;
	credits_granted_period: number;
	override_monthly_credits: number | null;
	period_start: string;
	updated_at: string;
	cost_period_micros: number;
}

export interface MessageUsage {
	id: string;
	user_id: string;
	message_id: string | null;
	thread_id: string | null;
	model: string;
	input_tokens: number;
	output_tokens: number;
	request_count: number;
	cost_usd_micros: number;
	credits_charged: number;
	created_at: string;
}

export interface UserUsageResponse {
	user_id: string;
	quota: UserQuota;
	recent_usage: MessageUsage[];
}
