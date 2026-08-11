// ---------------------------------------------------------------------------
// Quotations for the dashboard subtitle.
//
// Every line here is one I can attribute with confidence to the person named,
// and that constraint did real work: the most famous "discipline" quote on the
// internet — "We are what we repeatedly do. Excellence, then, is not an act but
// a habit" — is Will Durant summarising Aristotle in The Story of Philosophy,
// not Aristotle. It is credited correctly below rather than dropped, because
// the line is genuinely good and Durant wrote it.
//
// The same test excluded several staples of this genre. "It does not matter how
// slowly you go as long as you do not stop" has no source in Confucius, and
// "every battle is won before it is ever fought" is the film Wall Street rather
// than Sun Tzu. An app whose entire pitch is showing the actual maths cannot
// put a fabricated citation on its own front page.
//
// Anonymous proverbs are labelled as proverbs, which is the honest citation for
// something with no author.
// ---------------------------------------------------------------------------

export interface Quote {
  text: string;
  who: string;
}

export const QUOTES: Quote[] = [
  { text: "Be water, my friend.", who: "Bruce Lee" },
  {
    text: "I fear not the man who has practised ten thousand kicks once, but I fear the man who has practised one kick ten thousand times.",
    who: "Bruce Lee",
  },
  { text: "In the midst of chaos, there is also opportunity.", who: "Sun Tzu, The Art of War" },
  {
    text: "Victorious warriors win first and then go to war, while defeated warriors go to war first and then seek to win.",
    who: "Sun Tzu, The Art of War",
  },
  { text: "A journey of a thousand miles begins with a single step.", who: "Lao Tzu, Tao Te Ching" },
  {
    text: "You have power over your mind, not outside events. Realise this, and you will find strength.",
    who: "Marcus Aurelius, Meditations",
  },
  {
    text: "Waste no more time arguing about what a good man should be. Be one.",
    who: "Marcus Aurelius, Meditations",
  },
  {
    text: "It is not that we have a short time to live, but that we waste a lot of it.",
    who: "Seneca, On the Shortness of Life",
  },
  { text: "No man is free who is not master of himself.", who: "Epictetus" },
  {
    text: "We are what we repeatedly do. Excellence, then, is not an act but a habit.",
    who: "Will Durant, summarising Aristotle",
  },
  {
    text: "There is more than one path to the top of the mountain.",
    who: "Miyamoto Musashi, The Book of Five Rings",
  },
  { text: "Do nothing which is of no use.", who: "Miyamoto Musashi, The Book of Five Rings" },
  {
    text: "Dripping water hollows out stone, not through force but through persistence.",
    who: "Ovid",
  },
  { text: "No man ever steps in the same river twice.", who: "Heraclitus" },
  { text: "Fall seven times, stand up eight.", who: "Japanese proverb" },
  { text: "The best time to plant a tree was twenty years ago. The second best time is now.", who: "Proverb" },
];
