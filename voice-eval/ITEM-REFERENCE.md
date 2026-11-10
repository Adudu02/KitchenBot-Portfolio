# Reference for filling in order_expected

Copy the object for the item you need into `order_expected.items`. Adjust `quantity` and add flavors to `modifiers` if applicable. If there is no flavor: `"modifiers": []`.

## Canonical items (25)

```json
{ "item": "orden de alitas", "quantity": 1, "modifiers": [] },
{ "item": "media orden de alitas", "quantity": 1, "modifiers": [] },
{ "item": "kilo de alitas", "quantity": 1, "modifiers": [] },
{ "item": "media orden de alitas con papas", "quantity": 1, "modifiers": [] },
{ "item": "orden de alitas con papas y queso", "quantity": 1, "modifiers": [] },
{ "item": "orden de boneless", "quantity": 1, "modifiers": [] },
{ "item": "media orden de boneless", "quantity": 1, "modifiers": [] },
{ "item": "orden de boneless con papas y queso", "quantity": 1, "modifiers": [] },
{ "item": "media orden de boneless con papas y queso", "quantity": 1, "modifiers": [] },
{ "item": "hamburguesa clasica", "quantity": 1, "modifiers": [] },
{ "item": "hamburguesa de pollo crispy", "quantity": 1, "modifiers": [] },
{ "item": "hamburguesa con chorizo", "quantity": 1, "modifiers": [] },
{ "item": "hamburguesa de dos carnes", "quantity": 1, "modifiers": [] },
{ "item": "hamburguesa crispy con tocino", "quantity": 1, "modifiers": [] },
{ "item": "papas clasicas", "quantity": 1, "modifiers": [] },
{ "item": "papas con queso", "quantity": 1, "modifiers": [] },
{ "item": "papas especiales con queso y chorizo", "quantity": 1, "modifiers": [] },
{ "item": "dedos de queso", "quantity": 1, "modifiers": [] },
{ "item": "dedos de queso flaming hot", "quantity": 1, "modifiers": [] },
{ "item": "aros de cebolla", "quantity": 1, "modifiers": [] },
{ "item": "hot dog jumbo", "quantity": 1, "modifiers": [] },
{ "item": "pasta fettuccini con tiras de pollo crispy", "quantity": 1, "modifiers": [] },
{ "item": "pasta fettuccini clasica", "quantity": 1, "modifiers": [] },
{ "item": "tenders de pollo crispy", "quantity": 1, "modifiers": [] },
{ "item": "tenders doritos nacho", "quantity": 1, "modifiers": [] },
```

## Valid modifiers / flavors (5)

They go inside `modifiers`, e.g. `"modifiers": ["buffalo"]`.

```json
["bbq","mango habanero","buffalo","valentina","grande"]
```

## Filled-in example

```json
"order_expected": {
  "items": [
    { "item": "orden de alitas", "quantity": 1, "modifiers": ["buffalo"] },
    { "item": "papas con queso", "quantity": 2, "modifiers": [] }
  ]
}
```
