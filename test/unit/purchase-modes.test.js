import {
  registerPurchaseMode,
  purchaseModeList,
  applicablePurchaseModes,
  isPurchaseModeAvailable,
  getPurchaseMode,
  resetPurchaseModes
} from "../../module/purchase-modes.js";

const ownerView = { isOwnerView: true, purchaseNetworks: [], hasSelection: false, hasStaged: false, salesOpen: true };
const shopper = { isOwnerView: false, purchaseNetworks: ["i-rep"], hasSelection: true, hasStaged: false, salesOpen: true };

beforeEach(() => {
  resetPurchaseModes();
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  console.error.mockRestore();
});

describe("registering a purchase mode", () => {
  test("a mode with an id and a label is accepted", () => {
    expect(registerPurchaseMode({ id: "buy", label: "Buy" })).toBe(true);
    expect(getPurchaseMode("buy").label).toEqual("Buy");
  });

  test("a mode without an id or without a label is refused", () => {
    expect(registerPurchaseMode({ label: "No id" })).toBe(false);
    expect(registerPurchaseMode({ id: "noLabel" })).toBe(false);
    expect(purchaseModeList()).toEqual([]);
  });

  test("the same id cannot be taken twice", () => {
    expect(registerPurchaseMode({ id: "buy", label: "Buy" })).toBe(true);
    expect(registerPurchaseMode({ id: "buy", label: "Buy again" })).toBe(false);
    expect(purchaseModeList()).toHaveLength(1);
  });

  test("available and execute must be functions when given", () => {
    expect(registerPurchaseMode({ id: "a", label: "A", available: "yes" })).toBe(false);
    expect(registerPurchaseMode({ id: "b", label: "B", execute: 42 })).toBe(false);
    expect(purchaseModeList()).toEqual([]);
  });

  test("a rejected registration is reported rather than thrown", () => {
    expect(() => registerPurchaseMode({})).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("which modes apply", () => {
  test("a mode without an available check always applies", () => {
    registerPurchaseMode({ id: "always", label: "Always" });
    expect(applicablePurchaseModes(shopper).map(mode => mode.id)).toEqual(["always"]);
  });

  test("available decides per context", () => {
    registerPurchaseMode({ id: "favor", label: "Favor", available: context => !context.isOwnerView });
    expect(applicablePurchaseModes(shopper).map(mode => mode.id)).toEqual(["favor"]);
    expect(applicablePurchaseModes(ownerView)).toEqual([]);
  });

  test("only a literal true counts as available", () => {
    registerPurchaseMode({ id: "sloppy", label: "Sloppy", available: () => "yes" });
    expect(applicablePurchaseModes(shopper)).toEqual([]);
  });

  test("isPurchaseModeAvailable answers for one mode, and false for an unknown id", () => {
    registerPurchaseMode({ id: "buy", label: "Buy", available: context => context.hasSelection });
    expect(isPurchaseModeAvailable("buy", shopper)).toBe(true);
    expect(isPurchaseModeAvailable("buy", { ...shopper, hasSelection: false })).toBe(false);
    expect(isPurchaseModeAvailable("nothingLikeThis", shopper)).toBe(false);
  });
});

describe("footer button order", () => {
  test("modes come back lowest order first", () => {
    registerPurchaseMode({ id: "third", label: "C", order: 30 });
    registerPurchaseMode({ id: "first", label: "A", order: 10 });
    registerPurchaseMode({ id: "second", label: "B", order: 20 });
    expect(purchaseModeList().map(mode => mode.id)).toEqual(["first", "second", "third"]);
  });

  test("modes without an order keep registration order among themselves", () => {
    registerPurchaseMode({ id: "one", label: "One" });
    registerPurchaseMode({ id: "two", label: "Two" });
    expect(purchaseModeList().map(mode => mode.id)).toEqual(["one", "two"]);
  });

  test("ordering survives the availability filter", () => {
    registerPurchaseMode({ id: "late", label: "Late", order: 30 });
    registerPurchaseMode({ id: "early", label: "Early", order: 10 });
    registerPurchaseMode({ id: "hidden", label: "Hidden", order: 20, available: () => false });
    expect(applicablePurchaseModes(shopper).map(mode => mode.id)).toEqual(["early", "late"]);
  });

  test("a mode carries its footer button through to the caller", () => {
    registerPurchaseMode({ id: "buy", label: "Buy", footerButton: "shop-cart-action" });
    expect(applicablePurchaseModes(shopper)[0].footerButton).toEqual("shop-cart-action");
  });
});
