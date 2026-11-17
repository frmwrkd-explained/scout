{{ subject }}.

## Lines

| Item | Qty | Unit price | Amount |
|---|---:|---:|---:|
{{#each lines}}| {{ item.description }} | {{ item.quantity }} | {{ money(item.unit_price) }} | {{ money(item.amount) }} |
{{/each}}{{#if count(lines)}}{{else}}| {{ subject }} | 1 | {{ money(subtotal) }} | {{ money(subtotal) }} |
{{/if}}
{{#if tax}}Subtotal {{ money(subtotal) }} · Tax {{ tax_rate }}% {{ money(tax) }}

{{/if}}**Total: {{ money(total) }}** · due {{ date(due) }}
