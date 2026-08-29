# Google Play reviewer notes (template)

Use this in Play Console → App content / testing notes. **Do not invent demo accounts.** Founder supplies working Client / Driver / Restaurant credentials.

## What to test

1. **Client taxi:** Role select → Log in (Client) → Taxi → pickup/dropoff → official quote (Subtotal + Service Fee + Tax = Total) → confirm → pay with the provided test card. MMD AI never creates a ride or payment by itself.
2. **Client food:** Restaurant list → menu (options if the restaurant defined them) → server quote → confirm.
3. **Client package:** Delivery request → addresses + description → **server quote** → confirm. Weight/size are not required by the current pricing engine.
4. **Guest marketplace:** Browse catalog without login. Live checkout is **off** until payout certification.
5. **Driver:** Go Online. On Android, the **prominent background-location disclosure** appears **before** `requestBackgroundPermissionsAsync()`. Do not skip it.
6. **Account deletion:** Settings / Security → Delete account, or `https://www.mmddelivery.com/legal/account-deletion`.
7. **Safety Audio:** Foreground recording only. No background audio mode.

## Permissions (must match Data Safety)

See `docs/PLAY_DATA_SAFETY.md`. Background location is for active driver tracking only. Photos are used for delivery proof and profile images.

## Credentials

Client / Driver / Restaurant demo accounts: **founder-supplied — do not invent in this repo.**
