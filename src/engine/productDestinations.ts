import { buyGuideFor } from "./recommendations.js";
import type { Rec } from "./recommendations.js";

export interface ProductDestination {
  readonly productName: string;
  readonly manufacturer: string;
  readonly url: string;
  readonly label: string;
  readonly region: string;
  readonly checkedAt: string;
  readonly disclosure: string;
  readonly verificationScope: "product-identity-and-label";
}

const DISCLOSURE = "One example on the manufacturer's Australian site. Product information, not clinical validation or a promise of scan improvement.";

// Manually inspected manufacturer pages. Checking identity and label details
// does not validate marketing claims, personal suitability or local stock.
// Keep links literal: never synthesize a product URL from recommendation text.
const EXAMPLES: Readonly<Record<string, Readonly<ProductDestination>>> = Object.freeze({
  spf: Object.freeze({
    productName: "La Roche-Posay Anthelios Invisible Fluid Facial Sunscreen SPF 50+",
    manufacturer: "La Roche-Posay",
    url: "https://www.laroche-posay.com.au/sun-protection/face-sunscreens/anthelios-invisible-fluid-facial-sunscreen-spf-50/3337875733748.html",
    label: "View this example at La Roche-Posay",
    region: "Australia",
    checkedAt: "2026-09-10",
    disclosure: DISCLOSURE,
    verificationScope: "product-identity-and-label",
  }),
  emollient: Object.freeze({
    productName: "CeraVe Moisturising Cream",
    manufacturer: "CeraVe",
    url: "https://www.cerave.com.au/ceramides-skin-care/moisturisers/moisturising-cream",
    label: "View this example at CeraVe",
    region: "Australia",
    checkedAt: "2026-09-10",
    disclosure: DISCLOSURE,
    verificationScope: "product-identity-and-label",
  }),
  "gentle-cleanse": Object.freeze({
    productName: "Cetaphil Gentle Skin Cleanser",
    manufacturer: "Cetaphil",
    url: "https://www.cetaphil.com.au/product-categories/cleansers/gentle-skin-cleanser/50556.html",
    label: "View this example at Cetaphil",
    region: "Australia",
    checkedAt: "2026-09-10",
    disclosure: DISCLOSURE,
    verificationScope: "product-identity-and-label",
  }),
  niacinamide: Object.freeze({
    productName: "The INKEY List Omega Water Cream",
    manufacturer: "The INKEY List",
    url: "https://www.theinkeylist.com/products/omega-water-cream",
    label: "View this example at The INKEY List",
    region: "United States",
    checkedAt: "2026-09-10",
    disclosure: "One example on the manufacturer's US site. Product information, not clinical validation or a promise of scan improvement.",
    verificationScope: "product-identity-and-label",
  }),
});

/** Optional product information for an already-chosen category, not recommendation eligibility. */
export function productExampleFor(id: string): Readonly<ProductDestination> | null {
  return Object.prototype.hasOwnProperty.call(EXAMPLES, id) ? EXAMPLES[id] : null;
}

/** A buying-guide destination never turns a habit or guarded medicine into a product instruction. */
export function productDestinationFor(rec: Rec): Readonly<ProductDestination> | null {
  if (rec.guardian || rec.otc !== true) return null;
  const guide = buyGuideFor(rec);
  const example = productExampleFor(rec.id);
  if (!guide || !example || !guide.example.includes(example.productName)) return null;
  return example;
}
