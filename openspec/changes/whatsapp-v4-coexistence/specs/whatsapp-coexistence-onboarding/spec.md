# WhatsApp Coexistence Onboarding Specification

## Purpose

Secure, organization-scoped Embedded Signup v4 onboarding with manual fallback.

## Requirements

### Requirement: Owner authorization and attempt binding

Only an organization owner MAY start, complete, replace, inspect, or disconnect coexistence. Attempts MUST bind one organization/user, expire, and be single-use; non-owners MUST be denied without state changes.

#### Scenario: Owner starts

- GIVEN an authenticated owner
- WHEN onboarding starts
- THEN an expiring organization-bound attempt is returned

#### Scenario: Member denied

- GIVEN an authenticated non-owner member
- WHEN the member starts or completes onboarding
- THEN the request is denied and state is unchanged

### Requirement: Verified encrypted unique transition

The system MUST exchange codes server-side, verify WABA/phone ownership, encrypt credentials at rest, and redact codes/tokens. A phone-number ID MUST belong to one organization. The prior channel MUST remain active until Meta confirms coexistence and required verification/subscription succeed. Status/reason MUST be observable; rejection MUST leave no usable replacement credentials.

#### Scenario: Verified completion

- GIVEN a valid attempt and verified Meta assets
- WHEN completion succeeds
- THEN encrypted credentials and one atomic phone claim are stored

#### Scenario: Competing claims

- GIVEN two organizations race for one phone-number ID
- WHEN both completions execute
- THEN one succeeds and the other receives a non-leaking conflict

#### Scenario: Rejected confirmation

- GIVEN Meta rejects an in-progress attempt
- WHEN rejection is recorded
- THEN no replacement activates and rejection is observable

External validation boundary: v4 eligibility, payloads, and subscriptions require authenticated Meta fixture validation.
