---
id: invoice
name: Invoice
version: 1.0.0
kind: template
author: Scout
description: Turns a deal into a numbered invoice you can print or save as a PDF, and files it under Invoices.
actions:
  - id: create
    on: deals
    label: Create invoice
    template: invoice.html
    inputs:
      - key: number
        label: Invoice number
        type: text
        default: "next_number('invoices', concat('INV-', year(today), '-'), 3)"
      - key: date
        label: Invoice date
        type: date
        default: today
      - key: label
        label: What it is for
        type: text
        default: record.title
      - key: share
        label: Share of the deal (%)
        type: number
        default: "100"
        help: 50 for a deposit, 100 for the whole amount.
      - key: terms
        label: Payment terms (days)
        type: number
        default: "14"
      - key: tax_rate
        label: Tax (%)
        type: number
        default: "0"
      - key: note
        label: Note at the bottom
        type: longtext
        default: me.payment
    reads:
      client: record.company
      contact: record.person
    compute:
      - key: share
        value: default(input.share, 100)
      - key: lines
        each: record.line_items
        as:
          description: "concat(item.description, if(share < 100, concat(' (', share, '%)'), ''))"
          quantity: default(item.quantity, 1)
          unit_price: round(item.unit_price * share / 100, 2)
          amount: round(default(item.quantity, 1) * item.unit_price * share / 100, 2)
      - key: subject
        value: default(input.label, record.title)
      - key: subtotal
        value: if(count(lines), sum(lines, item.amount), round(record.amount * share / 100, 2))
      - key: tax_rate
        value: default(input.tax_rate, 0)
      - key: tax
        value: round(subtotal * tax_rate / 100, 2)
      - key: total
        value: subtotal + tax
      - key: number
        value: input.number
      - key: issued
        value: default(input.date, today)
      - key: due
        value: add_days(issued, default(input.terms, 14))
      - key: note
        value: input.note
    creates:
      collection: invoices
      fields:
        name: number
        status: "'draft'"
        date: issued
        due_date: due
        amount: total
        company: record.company
        deal: record.slug
        label: subject
        line_items: lines
        tax_rate: if(tax_rate > 0, tax_rate, null)
      body: invoice-note.md
  - id: print
    on: invoices
    label: Print or save as PDF
    template: invoice.html
    reads:
      client: record.company
      deal: record.deal
      contact: deal.person
    compute:
      - key: lines
        each: record.line_items
        as:
          description: item.description
          quantity: default(item.quantity, 1)
          unit_price: item.unit_price
          amount: default(item.quantity, 1) * item.unit_price
      - key: subject
        value: default(record.label, record.title)
      - key: subtotal
        value: if(count(lines), sum(lines, item.amount), record.amount)
      - key: tax_rate
        value: default(record.tax_rate, 0)
      - key: tax
        value: round(subtotal * tax_rate / 100, 2)
      - key: total
        value: subtotal + tax
      - key: number
        value: record.title
      - key: issued
        value: record.date
      - key: due
        value: record.due_date
      - key: note
        value: me.payment
---
The reference plugin. It shows the whole format in one folder:

- **Create invoice** sits on every deal. It reads the deal, the company and the contact it links to, and your business details from `me.md`; asks for a number, a date and the terms; shows the invoice; and files a new record under Invoices, linked back to the deal and the company.
- **Print or save as PDF** sits on every invoice and draws the same document from the stored record, so an invoice can be printed again at any time.

There is no code in this folder. `plugin.md` holds the form and the formulas, `invoice.html` is the document, and `invoice-note.md` is the note written into the new record.
