# Onboarding, plan offer and Max character roadmap

## Post-scan onboarding

The scan stays first. After capture, signup unlocks the first analysis. Keep the
required onboarding short enough that a person who has already completed the
scan does not abandon before seeing value.

### Required before the first analysis

- first name;
- last name;
- verified account email (read from Supabase Auth, not entered twice);
- age band needed for plan eligibility; and
- acceptance of Terms and Privacy Policy versions.

### Optional profile context

- mobile number;
- how they heard about TrueMax;
- main objective;
- what a good outcome would look like;
- what they expect from the app;
- strengths they want to build on;
- areas they want to improve; and
- features or topics they do not want the analysis or Max AI to mention.

Avoid requiring a free-text “insecurities” answer, especially for under-18
users. It is sensitive, increases onboarding friction and creates data that
needs stronger moderation, retention and deletion controls. A neutral,
optional “topics to avoid” checklist plus optional note achieves the product
goal with less harm.

Store profile answers in an RLS-protected `profiles` model, not user-editable
Auth metadata. Record consent versions and allow the user to edit or delete the
answers.

## Animated plan offer

After the first analysis, **Next** opens a full-screen Max-led transition:

- Starter on the left: $6.99 USD/month;
- Max on the right: $11.99 USD/month;
- hover/focus/tap reveals the exact benefits;
- the selected card explains the trial, renewal price and cancellation before
  Checkout;
- under-18 users see Max dimmed with a lock and a respectful explanation;
- “No thanks” remains visible and explains that another non-member scan costs
  $5.99; and
- reduced-motion users receive a clean fade rather than a flying animation.

The lock is explanatory UI only. Checkout must repeat the age-eligibility
check on the server.

## Max character

Max should first ship as a designed avatar in the dedicated Max AI tab. The
floating desktop character is a later experiment, not a payment-MVP blocker.

For the desktop experiment:

- show only the head at the screen edge;
- open a text bubble on click, never auto-play voice;
- allow dragging without covering scan controls or results;
- provide minimize, dismiss and “don’t show again” controls;
- save position and dismissed state locally;
- support keyboard movement and screen-reader labels; and
- disable by default on narrow/mobile layouts until usability testing proves
  it helps rather than distracts.

The avatar, plan-offer animation and assistant backend should remain separate
components so the visual character can change without changing billing or AI
logic.
