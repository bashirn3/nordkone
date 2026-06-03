# NordKone n8n Templates

These are safe templates only. They are not imported or activated anywhere.

## Configuration Rule

Do not use environment variables for these n8n workflows. Each template contains
an editable `Workflow Config` / `Classify + Build Reply` code node with:

- `apiBaseUrl`
- `apiKey`
- `wasupSendUrl`
- `fromPhone` / `fallbackFromPhone`

Fill those node values after importing the workflow.

## WF-1 Outbound

1. Cron trigger during Finnish business hours.
2. `Workflow Config` node provides API URL/key and Wasup sender phone.
3. Optional pre-launch test: fill `testRecipientPhone` with your own number.
   Leave it empty before launch.
4. `GET /api/outbound/candidates?limit=1`
   - returns no candidates unless `campaign_client_config.outbound_enabled = true`
   - enforces the configured `daily_cap` server-side
5. Send WhatsApp via Wasup:
   - `from_phone`: NordKone sender
   - `to_phone`: `testRecipientPhone` during test, otherwise `candidate.normalized_phone`
   - `message`: `candidate.outbound_message`
6. `POST /api/outbound/sent` with Nettikone ID, phone, message, provider message ID.

The dashboard controls WF-1 activation through `/api/settings`. Keep WF-1 active
in n8n only after one successful test send; the API still blocks sends while the
dashboard toggle is paused.

## WF-2 Inbound

1. Wasup inbound webhook.
2. `Workflow Config + Nordkone2 Prompt` contains the bridge config and the
   Nordkone2 Agent Builder prompt behavior.
3. `Fetch Lead Context` loads the latest matching Nettikone listing by sender phone.
4. `AI Agent - Nordkone2 Prompt` uses the Nordkone2 prompt + dynamic listing
   context to generate:
   - `reply_message`
   - `classification`
   - `needs_human`
5. `POST /api/webhooks/wasup/inbound` records the inbound reply and status.
6. `POST https://wasup2.northeurope.cloudapp.azure.com/api/send` replies to the seller.
7. Webhook responds with classification and `reply_sent = true`.

The AI node must use `Azure OpenAI Chat Model`, matching the existing workflows.
The template references the existing `Azure Open AI account` credential and
model `gpt-5`; confirm those values after import if the target n8n instance uses
different credential IDs.

Classifications:

   - `interested`
   - `sold`
   - `not_interested`
   - `opted_out`
   - `needs_human`
   - `unclear`

Classification rules are explicit in the agent prompt. Examples:

- `interested`: seller says the machine is still available, asks for a call,
  says `joo`, `kyllä`, `kiinnostaa`, asks about NordKone's model, pricing, or
  next steps.
- `sold`: machine is sold, reserved, or deals are done.
- `not_interested`: seller declines NordKone help but does not ask to stop all messages.
- `opted_out`: seller asks to stop, remove the number, or not message again.
- `needs_human`: valuable but ambiguous, complaint, special request, multiple machines.
- `unclear`: no intent can be inferred.

Current reply examples:

- Interested: `Kiitos! Hyvä kuulla. Välitän tiedon NordKoneen tiimille, niin he voivat olla yhteydessä.`
- Sold: `Selvä, kiitos tiedosta ja onnea kaupoista!`
- Opt-out/not interested: `Selvä, kiitos tiedosta. Emme häiritse enempää.`
- Unclear: `Kiitos viestistä! Välitän tämän NordKoneen tiimille, niin he voivat katsoa asian.`
