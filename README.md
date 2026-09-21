# Eclipse Phase — Shops

Shops for the [Eclipse Phase](https://github.com/Artemystra/eclipsephase) system for Foundry VTT:
stock management, Rep-based purchases, favors, selling and shop loyalty.

Requires the Eclipse Phase system in version 2.5 or later. The module contributes its own actor
sub-type, `eclipsephase-shop.shop`, and registers against the system's public extension API
(`game.eclipsephase.api`) rather than patching it.

## Installation

Install by manifest URL:

```
https://raw.githubusercontent.com/Artemystra/eclipsephase-shop/main/module.json
```

## Migrating from system versions before 2.5

Shops used to be a system actor type. On the first world load with this module active, every
existing shop actor is moved onto the module's own type, keeping its id so tokens on scenes keep
working. The migration runs once per world and reports what it did.

## Development

```
npm install
npm test
```
