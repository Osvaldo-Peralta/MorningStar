# MorningStar Architecture Baseline v1.0
- Status: Frozen Baseline – Architectural Reference
---
## 1. Identity Module
> `Purpose`:
Manages user identity as a domain aggregate independent of authentication and authorization.
### Aggregate Root
- User
### Core Fields
- username (unique, alphanumeric)
- displayName (full Unicode)
- accountType
- accountStatus
- verificationFlags
- internal flags
---
### AccountStatus Lifecycle
States:
- PENDING_VERIFICATION
- ACTIVE
- SUSPENDED
- DEACTIVATED
- BANNED

Controlled by StatusTransitionPolicy.

Key rules:
- Email verification does not reactivate SUSPENDED accounts.
- VERIFIED occurs upon email confirmation.
- No automatic reactivation from SUSPENDED.
- Re-auth required for sensitive changes.

---

### AccountType
- PERSONAL
- CREATOR
- OFFICIAL
- GOVERNMENT

Convertible under controlled policies.
---
### EmailVerificationToken Lifecycle
- Generated per request
- Single-use
- Expires
- Invalidates previous active tokens

Does not change account status if SUSPENDED

---

# 2. Authentication Module
> `Purpose`:
Manages credentials and sessions.
### Responsibilities

- Login / Logout
- Refresh Tokens
- Change Password
- Reset Password
- MFA
- Session issuance
- Device fingerprint tracking

---

### Session Model

Includes:
- userId
- deviceFingerprint
- issuedAt
- expiresAt
- riskSnapshot

Supports mass invalidation under ACTIVE_DEFENSE.
---
# 3. Authorization Module
> `Purpose`: 
Evaluates permissions under formal policies.

Consumes RiskAssessment.

Decision Model
- ALLOW
- DENY
- CONDITIONAL
---
### SecurityContext
Contains:
- actorId
- roles
- accountStatus
- accountType
- verifiedAttributes
- sessionInfo
- riskLevel

No DB access inside evaluation.
---
# 4. Risk Engine
> `Purpose`:
Evaluates contextual risk per request.

### Contract
```typescript
interface RiskEngine {
assess(context): RiskAssessment
}
```
### RiskAssessment

- riskScore (0–100)
- riskLevel (LOW, MEDIUM, HIGH, CRITICAL)
- signals[]
- recommendedAction

### DeviceTrust Lifecycle
- NEW
- KNOWN
- TRUSTED
- REVOKED

Fail-safe: defaults to elevated risk if evaluation fails.

---

# 5. Audit Trail
> `Purpose`:
Immutable record of:

- Authorization decisions
- Risk evaluations
- Status transitions
- Security escalations
- Credential events

Append-only.

---

# 6. Event Versioning Strategy
### Rules

- Explicit version suffix (_v1, _v2)
- Never modify existing payload
- Only extend
- Consumers must tolerate unknown fields

---

7. Security Architecture Blueprint

Includes:
- Risk Engine
- Threat Intelligence
- Adaptive Escalation

### ThreatResponseLevel
- PASSIVE
- DETERRENCE
- ACTIVE_DEFENSE

### Behavior
Escalation based on:
- Volume
- Distribution
- Persistence
- Severity

Includes auto-deescalation.

Prepared for future manual override (not active).

---