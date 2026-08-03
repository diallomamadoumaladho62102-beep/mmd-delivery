# Tax Engine

## Responsibility

Compute **regulatory tax lines** only.

## Inputs

`IQuoteContext` + taxable base from Rate (and fee taxability as defined by Tax Rules).

## Outputs

`ITaxResult`: `tax_total_cents`, `lines[]` (code, rate, amount).

## Invariants

- Uses tax catalog / country config only (no legacy hardcoded rates in business code).
- Does not emit platform service fees or promotions.

## Errors

- `TAX_CATALOG_MISSING`
- `TAX_COUNTRY_UNSUPPORTED`
- `TAX_CURRENCY_MISMATCH`

## Example

US food order → sales tax line(s) from catalog `applies_to=food` for the country.
