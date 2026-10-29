const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Turns the entities in XML text back into characters: `&amp;`, `&lt;`, `&#233;`, `&#xE9;`. */
export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, entity: string) => {
		if (entity.startsWith('#')) {
			const code =
				entity[1]?.toLowerCase() === 'x'
					? Number.parseInt(entity.slice(2), 16)
					: Number(entity.slice(1));

			return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
		}

		return NAMED[entity.toLowerCase()] ?? whole;
	});
}
