# Kodiak Connect Account and Role Model

Kodiak Connect roles are responsibilities, not immunity.

No account type, paid tier, server role, business role, parent status, moderator position, or ownership status allows a user to bypass platform safety rules.

## Core rule

```text
No account type gives immunity.
```

All users remain subject to Kodiak Connect platform rules, safety review, enforcement, suspension, bans, and lawful escalation when required.

## Role layers

Kodiak Connect uses separate role layers so authority stays clear.

```text
User Identity Layer
Platform Role Layer
Account Relationship Layer
Space / Server Role Layer
Safety Status Layer
```

A single person may hold multiple roles at the same time.

Example:

```text
A user may be:
- A parent
- A business owner
- A server owner
- A moderator in another server
- A regular member elsewhere
```

None of those roles bypass platform safety enforcement.

## User identity layer

Represents the real account/person relationship to the platform.

```text
Individual
Parent / Guardian
Child / Dependent
Business Owner
Kodiak Staff
Security Specialist
```

## Platform role layer

Platform roles are controlled only by Kodiak Connect.

### Kodiak Platform Owner

- Full platform authority.
- Can appoint or remove Trust & Safety staff.
- Can define platform-wide safety policies.
- Can suspend, restrict, or remove users globally.
- Can approve final escalation workflows.

### Kodiak Trust & Safety / Security Specialist

- Can review platform-level safety incidents.
- Can review red-flag incidents.
- Can take platform-level enforcement actions within assigned authority.
- Can preserve evidence according to policy.
- Can escalate severe incidents to the platform owner and lawful reporting process.

### Platform staff restrictions

Platform staff must not use their access for curiosity, personal reasons, retaliation, or unauthorized monitoring.

Every staff action that touches private, sensitive, or flagged user content should be logged and reviewable.

## Account relationship layer

Account relationships define responsibilities between accounts.

### Individual

- Can join allowed spaces.
- Can create spaces when permitted.
- Can participate in direct messages and channels.
- Can report content or users.
- Can be flagged, restricted, suspended, banned, or escalated.

### Parent / Guardian

Parent/Guardian status gives authority over linked child/dependent accounts. It does not restrict the parent from normal platform use.

Parent/Guardian accounts:

- Can join servers/spaces like any other user.
- Can create or own servers/spaces when permitted.
- Can participate in public, private, family, or business spaces if allowed.
- Can manage linked child/dependent accounts.
- Can invite family members.
- Can view family safety reports according to policy.
- Can set restrictions for linked child/dependent accounts.
- Cannot access unrelated users' private activity.
- Cannot override platform Trust & Safety.
- Can still be warned, restricted, suspended, banned, or reported if they violate rules.

### Child / Dependent

- Belongs to a linked family account.
- May have restrictions set by a parent/guardian.
- May have age-appropriate limitations.
- Must receive clear, age-appropriate safety notices.
- Still has personal privacy rights according to policy and law.
- Can report abuse, harassment, or unsafe conduct.

### Business Owner

- Can create and manage business spaces.
- Can manage business members, channels, roles, invites, and settings.
- Can receive business-space reports according to policy.
- Cannot disable platform-level safety systems.
- Cannot hide or destroy platform-level safety evidence.
- Cannot override platform enforcement.
- Can still be flagged, restricted, suspended, banned, or escalated.

## Space / server role layer

Space roles apply only inside a specific space/server.

```text
Owner
Admin
Moderator
Member
Guest / Limited Member
```

### Server Owner

- Can manage their server/space.
- Can create channels.
- Can manage space-level roles.
- Can invite or remove members from their space.
- Can moderate normal space-level issues.
- Can receive reports related to their space when policy allows.
- Cannot disable platform safety.
- Cannot view platform-only incident evidence unless specifically permitted.
- Cannot override platform bans, restrictions, or investigations.

### Server Admin / Moderator

- Can moderate assigned spaces/channels.
- Can enforce server rules.
- Can escalate reports to server owner or platform Trust & Safety.
- Cannot access unrelated spaces.
- Cannot override platform safety.

## Safety status layer

Safety status applies globally, regardless of account type.

```text
Good Standing
Flagged
Under Review
Restricted
Suspended
Banned
Lawful Escalation Pending
```

### Good Standing

Normal account status.

### Flagged

A report, automated safety signal, or platform review has identified a potential issue.

Flagged status does not automatically mean the user is guilty. It means the incident requires review.

### Under Review

A Trust & Safety reviewer is examining the incident.

### Restricted

The user may have temporary limitations such as reduced messaging ability, blocked contact with certain users, removal from spaces, or restricted invite capability.

### Suspended

The account is temporarily disabled or locked pending review.

### Banned

The account is removed from the platform.

### Lawful Escalation Pending

A severe incident is being prepared for legally required or appropriate reporting.

## Enforcement principle

```text
All users are subject to platform-wide safety rules, regardless of whether they are an individual, parent, business owner, server owner, moderator, staff member, or premium customer.
```

## Product design implication

The UI and backend must never assume that server ownership equals platform authority.

Platform-level controls should be separated from server-level tools.

```text
Server Settings / Owner Tools
Platform Trust & Safety Tools
Family Management Tools
Business Management Tools
```

Each toolset must have different permissions, audit logs, and review expectations.
