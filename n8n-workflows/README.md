# NordKone n8n Templates

These are safe templates only. They are not imported or activated anywhere.

## WF-1 Outbound

1. Cron trigger during Finnish business hours.
2. `GET /api/outbound/candidates?limit=1`
3. Send WhatsApp via Wasup:
   - `from_phone`: NordKone sender
   - `to_phone`: `candidate.normalized_phone`
   - `message`: `candidate.outbound_message`
4. `POST /api/outbound/sent` with Nettikone ID, phone, message, provider message ID.

Daily cap should be enforced in n8n or with a later API-side claim endpoint once the
production cadence is confirmed.

## WF-2 Inbound

1. Wasup inbound webhook.
2. AI/classifier node can return:
   - `interested`
   - `sold`
   - `not_interested`
   - `opted_out`
   - `needs_human`
   - `unclear`
3. `POST /api/webhooks/wasup/inbound`
4. If `needs_human = true`, notify the NordKone team.
