# Email — do we need it, and with what

Whether Custeio needs transactional email, and which tool to use. Prompted by the question "how
do we notify the client of formal/legal matters", which was left out when we decided that the
day-to-day channel is [WhatsApp](./whatsapp-quick-query.md).

> Researched on 2026-09-19. No email infrastructure exists in the project today — confirmed by
> checking the code: zero sending dependencies (`nodemailer`, `resend`, `SES`, etc.), auth is just
> NextAuth `Credentials` (email/password login, no magic link), and the existing password reset
> (`USERS_RESET_PASSWORD`) is an admin action (System/Support resets another person's password),
> not a "forgot my password" flow that would need to send email by itself.

## Do we need email in the MVP?

**Not for anything that exists today** — no current flow depends on it:

- Login is credentials, with no email magic link.
- Password reset is done by an admin, not self-service.
- The onboarding invite (`POST /invite-token`, see [organizations.md](./organizations.md)) already
  shows the link once on screen to whoever generated it — presumably passed on by
  WhatsApp/phone to the store owner, not by email.
- The receipt/invoice for the subscription charge: Asaas sends that on its own (default payment
  gateway behavior) — we do not need to build it.

**Yes, for one case that has no place yet**: **formal/legal** communication — a data-breach notice
(a LGPD obligation), a change to the privacy policy/terms of use, or anything that needs a more
durable, auditable record than a WhatsApp message (which can be deleted, and is not the channel an
authority or a lawyer expects to see as proof of formal notification). This was already latent in
[go-live-checklist.md](../operations/go-live-checklist.md) (legal/LGPD section) — it is the same
hole, only now named.

## Tool — comparison (for our volume: tens of emails/month, not thousands)

| Tool                                     | Price at our volume                                                            | Note                                                                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Azure Communication Services (Email)** | ~US$0.00025/email + data transferred — fractions of a cent/month at our volume | The same cloud vendor we already use (Blob/Azurite, and the Key Vault direction discussed in [sefaz-nfe.md](./sefaz-nfe.md)) — brings in no new provider                                                      |
| **Resend**                               | Free up to 3,000 emails/month (100/day limit)                                  | Great developer experience, built for the Next.js/React Email ecosystem — but it is a new vendor, and the 100/day limit could be a nuisance for a legal notice sent to all clients at once, if the base grows |
| **Amazon SES**                           | Cheapest at scale (US$0.10/1,000)                                              | Only pays off at high volume; it would bring AWS in as a second cloud vendor just for this — makes no sense now                                                                                               |
| **SendGrid / Postmark**                  | More expensive in our volume range                                             | Aimed at those who already send high volume or want a full email product (marketing + transactional) — not our case                                                                                           |

## Recommendation

**Azure Communication Services**, by the same reasoning already used for the SEFAZ certificate's
Key Vault: we are already in the Azure ecosystem, the cost at our volume is negligible, and it
avoids adding yet another external vendor for a still-small use. Resend stays as the alternative if
the development experience (React templates, simpler DX) outweighs staying with the same vendor —
it is not a wrong choice, just not the one I would settle on without that conversation.

## Open / not implemented

- No integration has been built — this is only the choice of tool, for when the first real use
  case (probably the legal/LGPD notice) appears.
- Any tool chosen requires a **verified domain** (SPF/DKIM/DMARC records) — it does not work with a
  personal Gmail as the sender. Custeio needs a domain of its own before configuring this.
- We have not decided whether the onboarding invite should also go by email (today it is just
  copied from the screen) — left open, low priority next to the legal case above.
