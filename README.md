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

## Disabling or removing the module

The shop is an actor type this module owns, so switching the module off leaves those actors with a
type nobody provides. Foundry then reports one console error per shop on world load and hides them.
**Nothing is lost:** the data stays in the world untouched, and switching the module back on brings
every shop back exactly as it was.

To remove the module for good, delete the shop actors **while the module is still active**, then
disable it.

One more thing worth knowing: chat cards created before version 2.5 of the system carry no shop
data. Rescuing such an old card's favor roll with a pool spend still spends the pool but no longer
completes the purchase. Only cards from 2.5 onwards carry what that needs.

## Settings

Two house rules ship switched **on**, each switchable on its own under Game Settings:

| Setting | What it controls |
|---|---|
| **Allow buying with Rep** | The Buy and Trade routes, and the "Buys For" column of the rate tables |
| **Allow trading morphs** | Stocking, buying and asking for morphs, and the Morph Point override section |

Neither is RAW. Selling is unaffected by both and is always available.

Both start switched on in every world, including worlds upgrading from earlier versions, where
these routes used to follow the system's Special Brew setting.

## Extending the shop

Another module can add a payment route without patching the sheet. The shop's own "Cash in Favor"
and "Sell" are registered the same way, and "Buy" (the flat-Rep house rule) is registered too.

```js
Hooks.once("ready", () => {
  const shop = game.modules.get("eclipsephase-shop").api;

  shop.registerPurchaseMode({
    id: "my-module.barter",
    label: "my-module.shop.barter",
    order: 40,                       // ascending; the shop's own routes sit at 10, 20 and 30
    footerButton: "shop-cart-action",
    available: context => !context.isOwnerView && context.hasSelection,
    execute: context => myBarterFlow(context.shop, context.character)
  });
});
```

`available(context)` must return `true` for the route to be offered. The context describes the
shop as the sheet currently sees it: `sheet`, `shop`, `character`, `isOwnerView`,
`purchaseNetworks`, `hasSelection`, `hasStaged` and `salesOpen`.

Two more seams:

- **Hook** `eclipsephase-shop.prepareContext(sheet, context)` fires as the last step of the shop
  sheet's context preparation, for adding fields a slot template needs.
- **Slots** `shop.footer.buttons` and `shop.settings.sections` are rendered by the shop's own
  templates. Fill them with the system's slot registry
  (`game.eclipsephase.api.registry.registerSlot`), remembering to preload your template, since
  slots render as synchronous Handlebars partials.
