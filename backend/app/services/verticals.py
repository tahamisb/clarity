"""
Business verticals — derived from vendor platform_name.

The canonical list below is the full set of real verticals. Historic renames
of the same platform are merged (The Stars→Stars, Last Mile Delivery→Last
Mile, Health & Beauty→Health & Wellness), and junk values (NULL, 'Fuala
ALEID', 'Al Safliya Island test') normalize to NULL — they never appear as a
filter option or a breakdown row, but their orders still count under "All".

Orders (vendor_kpi) carry platform_name directly. Messages and calls only
carry a merchant name, so they resolve their vertical through MERCHANT_CTE —
a majority-vote map of restaurant_name → platform built from vendor_kpi.
"""

# Ordered by order volume — this order is mirrored in the UI dropdown.
VERTICALS = (
    "Restaurants",
    "Grocery",
    "Market",
    "Health & Wellness",
    "Stars",
    "Flowers",
    "Charity",
    "Last Mile",
    "Pets",
    "Pet Grooming",
    "Events",
    "Salons",
    "OUTLET",
)

# Historic platform renames → canonical name.
_MERGES = {
    "The Stars": "Stars",
    "Last Mile Delivery": "Last Mile",
    "Health & Beauty": "Health & Wellness",
}

_IN_CANONICAL = "('" + "', '".join(VERTICALS) + "')"


def is_valid(vertical: str) -> bool:
    return vertical in VERTICALS


def normalize(platform_name: str | None) -> str | None:
    """Python-side twin of vertical_case(). None ⇒ no recognised vertical."""
    if platform_name is None:
        return None
    merged = _MERGES.get(platform_name, platform_name)
    return merged if merged in VERTICALS else None


def vertical_case(col: str) -> str:
    """SQL expression mapping a platform_name column to its canonical vertical
    (renames merged; unrecognised/NULL → NULL)."""
    whens = " ".join(f"WHEN {col} = '{alias}' THEN '{canon}'" for alias, canon in _MERGES.items())
    return f"CASE {whens} WHEN {col} IN {_IN_CANONICAL} THEN {col} ELSE NULL END"


def vertical_pred(vertical: str | None, col: str = "platform_name") -> str:
    """
    ` AND <vertical of col> = '<vertical>'` fragment for an existing WHERE
    clause, "" when no filter. `vertical` must be pre-validated with is_valid()
    (whitelist ⇒ safe to interpolate, matching the _date_pred convention).
    """
    if not vertical:
        return ""
    assert is_valid(vertical), f"unvalidated vertical: {vertical!r}"
    return f" AND {vertical_case(col)} = '{vertical}'"


def merchant_cte(vendor_kpi_ref: str = "vendor_kpi") -> str:
    """
    `mv` CTE body: merchant name → vertical (majority platform of its orders).
    Join with `LEFT JOIN mv ON <name expr> = mv.merchant_name`; apply
    vertical_case("mv.platform") to get the canonical vertical.
    """
    return f"""mv AS (
        SELECT restaurant_name AS merchant_name,
               mode_value(platform_name) AS platform
        FROM {vendor_kpi_ref}
        WHERE restaurant_name IS NOT NULL AND TRIM(restaurant_name) != ''
        GROUP BY 1
    )"""
