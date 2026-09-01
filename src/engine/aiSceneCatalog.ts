import type { PairSex } from "./aiPairPrompt.js";

// ---------------------------------------------------------------------------
// The scenes an approved character gets filmed in.
//
// The before/after pair is a CHARACTER SHEET: one person, plain background,
// neutral clothing, front on. It exists to be approved, not to be posted. These
// are the posts: the same person doing something, somewhere, in an outfit.
//
// WHY THIS IS A CATALOGUE AND NOT A TEXT BOX. Same reason as the flaw chips.
// Every scene here is a setting, a camera and a light; none of them touches the
// face. A free box would let "sharper jaw" or "slimmer face" into a frame that
// is supposed to differ from its pair only by grooming and condition, and the
// whole before/after claim rests on the bones being the same in both.
//
// WHAT THE ENTRIES ARE BUILT FROM. Eight female and four male reference videos,
// read frame by frame rather than from a description of them. The patterns that
// held across all of them, and which no written brief would have produced:
//
//   - The camera is a phone the subject is holding. Every single reference
//     drifts and tilts. Left unsaid, a model returns a clean studio portrait,
//     which is exactly what makes AI UGC read as AI.
//   - The women's framing crops at mid-thigh, not head-to-toe and not
//     head-and-shoulders, with the camera at chest height pointing slightly up.
//   - The men's framing is far tighter, chin to hairline, and its defining
//     device is hard coloured directional light carving the jaw. That appeared
//     in the male references and in none of the female ones.
//   - Backgrounds are ordinary and cluttered: a ceiling fan, a bathroom counter
//     with things on it, a car park through a window. The mess is the realism.
//   - Motion is small and repeating. Nobody is dancing hard.
//
// So the sexes differ here in FRAMING AND LIGHT, not merely in location. That
// is the part a location list would have missed.
// ---------------------------------------------------------------------------

export interface AiScene {
  id: string;
  /** What the operator picks it by. */
  label: string;
  /** Where it happens, and what is visibly in the background. */
  setting: string;
  /** How the shot is framed and where the camera is. */
  camera: string;
  /** The light, which is the largest single difference between the sexes. */
  light: string;
  /** What the person is doing. An action, never a pose held for a camera. */
  action: string;
  /** Clothing, kept to what the references actually show. */
  wardrobe: string;
}

/** Held identical in every scene: the thing that separates UGC from a studio shot. */
export const HANDHELD =
  "Shot on a phone held by the person themselves. Slightly off-level, a little " +
  "handheld drift, natural imperfect framing. Photorealistic, the look of a real " +
  "phone camera rather than a studio photograph or a render.";

const MEN: AiScene[] = [
  {
    id: "gym-mirror",
    label: "Gym mirror",
    setting: "In a gym, in front of the mirrored wall, racks and plates and machines visible behind them.",
    camera: "Mirror selfie, phone held up and visible in the reflection, framed from the top of the thighs to just above the head.",
    light: "Hard overhead gym lighting, bright, with the shadows falling straight down.",
    action: "Flexing an arm and checking the mirror, mid-movement rather than posed.",
    wardrobe: "A fitted training vest or a t-shirt with the sleeves cut, and shorts.",
  },
  {
    id: "car-night",
    label: "Car at night",
    setting: "Sitting in the driver's seat of a car at night, headrests and the window behind them, car park lights and traffic out of focus outside.",
    camera: "Arm's length selfie from slightly below, framed from the chest up, the seat and roof lining filling the edges.",
    light: "Very low and dim. The face lit mostly by the phone screen and the lights outside, deep shadow everywhere else.",
    action: "Looking straight into the lens, head tipped slightly back against the headrest.",
    wardrobe: "Bare chested, or an open jacket over nothing.",
  },
  {
    id: "led-portrait",
    label: "Coloured light close-up",
    setting: "Outside at night, or a dark room. The background is almost black with a single distant light in it.",
    camera: "Close selfie, chin to hairline filling the frame, held slightly below eye level so the jaw is the nearest thing to the lens.",
    light: "Hard coloured directional light, magenta on one side and blue on the other, raking across the face so the jawline and cheekbone catch the edge.",
    action: "Head turning slowly through the light, mouth relaxed, eyes to the lens.",
    wardrobe: "A dark hoodie or a black tee, a chain visible at the neck.",
  },
  {
    id: "night-walk",
    label: "Walking at night",
    setting: "Walking outdoors at night, trees and street lights far behind and out of focus.",
    camera: "Selfie held at arm's length above eye level, framed from the shoulders up, the frame moving with each step.",
    light: "Dark, with a warm street light behind them and the phone screen lifting the face.",
    action: "Walking and talking to the camera, moving through the frame.",
    wardrobe: "A cap, a dark tee, a backpack strap across the chest.",
  },
  {
    id: "beach-day",
    label: "Beach, daylight",
    setting: "On a beach in bright daylight, sea and wet sand behind, other people small and out of focus in the distance.",
    camera: "Held at arm's length at chest height pointing slightly up, framed from mid-thigh to above the head.",
    light: "Full open sunlight, hard shadows, a bright sky behind.",
    action: "Walking towards the camera, shoulders loose, mid-stride.",
    wardrobe: "Bare chested with swim shorts.",
  },
  {
    id: "scenic-view",
    label: "Viewpoint",
    setting: "At a high outdoor viewpoint, a city or a coastline spread out far below and behind them.",
    camera: "Held at arm's length at chest height, framed from the waist up, the view filling everything behind.",
    light: "Late afternoon sun low and warm, coming from behind so it edges the shoulders and jaw.",
    action: "Turning back from the view towards the lens, caught mid-turn.",
    wardrobe: "A plain fitted t-shirt or a light open overshirt.",
  },
  {
    id: "going-out",
    label: "Dressed up at night",
    setting: "Somewhere in a city at night, out of focus lights and signage behind, a doorway or a lit street.",
    camera: "Held slightly below eye level, framed from the chest up, close and slightly angled.",
    light: "Mixed street light, warm on one side and cool on the other, contrasty.",
    action: "Adjusting a collar or a chain and looking straight at the lens.",
    wardrobe: "A well fitted dark shirt or a jacket, sharp and deliberate.",
  },
  {
    id: "post-training",
    label: "Straight off the court",
    setting: "Outdoors on a court or a pitch, fencing and floodlights or open sky behind, mid session.",
    camera: "Held at arm's length just above eye level, framed from the waist up, the frame moving with them.",
    light: "Hard daylight or floodlight from above, sweat catching the light.",
    action: "Breathing hard between points, glancing at the camera and away again.",
    wardrobe: "A training vest or a jersey, shorts.",
  },
];

const WOMEN: AiScene[] = [
  {
    id: "bedroom",
    label: "Bedroom",
    setting: "Standing in an ordinary bedroom. A ceiling fan above, a made bed, a television on the wall, a window with curtains. Lived in rather than styled.",
    camera: "Phone held at chest height pointing slightly up, framed from mid-thigh to just above the head, the whole figure in the frame.",
    light: "Ordinary warm room light, soft and even, daylight through the window behind.",
    action: "Turning slowly on the spot and lifting a hand through their hair, small repeating movement.",
    wardrobe: "A fitted single-colour mini dress, or a fitted top and shorts.",
  },
  {
    id: "bathroom-mirror",
    label: "Bathroom mirror",
    setting: "In front of a bathroom mirror. A counter with bottles and clutter on it, a door frame, a bright window off to one side.",
    camera: "Mirror selfie, the phone held up and clearly visible in the reflection covering part of the face, framed from the hips up.",
    light: "Bright daylight from the window, flat and slightly blown out on the wall behind.",
    action: "Half turning to check the mirror, free hand at the waist or lifting the hair.",
    wardrobe: "A fitted tube top or a cropped top, low waisted.",
  },
  {
    id: "car-night",
    label: "Car at night",
    setting: "Sitting in a car at night, the seat and roof lining around them, a car park and its lights out of focus through the window behind.",
    camera: "Held at arm's length just below eye level, framed from the chest up, close enough that the shoulders touch the edges.",
    light: "Dim and warm. The face lit by the phone and the lights outside, everything else falling to black.",
    action: "Talking to the camera and gesturing with one hand near the face.",
    wardrobe: "An oversized printed tee, or a fitted top.",
  },
  {
    id: "gym-mirror",
    label: "Gym mirror",
    setting: "In a gym in front of the mirrored wall, dumbbell racks and machines behind them.",
    camera: "Mirror selfie, phone visible in the reflection, framed from mid-thigh to above the head.",
    light: "Bright overhead gym lighting, even and slightly cool.",
    action: "Standing side on to the mirror and glancing back at it, weight on one hip.",
    wardrobe: "A matching fitted training set, cropped top and leggings or shorts.",
  },
  {
    id: "beach-day",
    label: "Beach, daylight",
    setting: "On a beach in bright daylight, sea and wet sand behind, palms and other people small in the distance.",
    camera: "Held at chest height pointing slightly up, framed from mid-thigh to above the head.",
    light: "Full open sunlight, a bright sky, hard clean shadows.",
    action: "Walking towards the camera and gesturing, mid-stride.",
    wardrobe: "A fitted cropped tee and shorts.",
  },
  {
    id: "scenic-view",
    label: "Viewpoint",
    setting: "At a high outdoor viewpoint, a coastline or a valley spread out far below and behind them.",
    camera: "Held at chest height pointing slightly up, framed from mid-thigh to above the head, the view filling the background.",
    light: "Late afternoon sun low and warm, coming from behind and catching the edges of the hair.",
    action: "Turning back from the view towards the lens, hair moving, caught mid-turn.",
    wardrobe: "A fitted top and a long skirt or shorts, light fabric moving in the wind.",
  },
  {
    id: "going-out",
    label: "Dressed up at night",
    setting: "Somewhere in a city at night, out of focus lights behind, a lit doorway or a restaurant window.",
    camera: "Held at chest height pointing slightly up, framed from mid-thigh to above the head.",
    light: "Warm street light with cooler light behind, contrasty and flattering.",
    action: "Half turning to check the shot, one hand at the hem, weight on one hip.",
    wardrobe: "A well fitted going-out dress, plain and dark, deliberately dressed up.",
  },
  {
    id: "filming-tiktok",
    label: "Filming a TikTok",
    setting: "In an ordinary room with the phone propped up rather than held, a bed or a sofa and a wall of posters behind.",
    camera: "Propped at chest height and completely still, framed from mid-thigh to above the head, the whole figure in shot.",
    light: "Ordinary warm room light with a window off to one side.",
    action: "Doing a small repeating dance to a song, arms and hips moving, looking just past the lens at their own screen.",
    wardrobe: "A fitted top and shorts, casual and at home.",
  },
];

export function scenesFor(sex: PairSex): readonly AiScene[] {
  return sex === "female" ? WOMEN : MEN;
}

/** A scene by id, for the sex it belongs to. Unknown ids get nothing. */
export function sceneById(sex: PairSex, id: string): AiScene | null {
  return scenesFor(sex).find((scene) => scene.id === id) ?? null;
}
