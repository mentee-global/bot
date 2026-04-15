interface LogoProps {
	className?: string;
}

export function MenteeLogo({ className }: LogoProps) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 230 224"
			fill="currentColor"
			className={className}
			aria-hidden="true"
		>
			<title>MENTEE</title>
			<rect x="72" y="0" width="17" height="224" />
			<rect x="141" y="0" width="17" height="224" />
			<rect x="106" y="0" width="18" height="82" />
			<rect x="106" y="97" width="18" height="20" />
			<rect x="106" y="133" width="18" height="91" />
			<rect x="0" y="0" width="89" height="18" />
			<rect x="141" y="0" width="89" height="18" />
			<rect x="6" y="34" width="83" height="16" />
			<rect x="141" y="34" width="83" height="16" />
			<rect x="6" y="62" width="219" height="16" />
			<rect x="6" y="78" width="13" height="58" />
			<rect x="34" y="78" width="14" height="58" />
			<rect x="183" y="78" width="14" height="58" />
			<rect x="213" y="78" width="12" height="58" />
			<rect x="72" y="78" width="87" height="4" />
			<rect x="72" y="97" width="87" height="20" />
			<rect x="72" y="132" width="87" height="4" />
			<rect x="6" y="136" width="219" height="16" />
			<rect x="8" y="182" width="81" height="17" />
			<rect x="141" y="182" width="81" height="17" />
			<rect x="6" y="208" width="83" height="16" />
			<rect x="141" y="208" width="84" height="16" />
		</svg>
	);
}
