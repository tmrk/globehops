import type { Locale } from './locales.ts';
export interface PageMetadata {
  title: string;
  description: string;
  socialDescription: string;
  imageAlt: string;
  noscript: string;
  guide: string;
  /** The static 404 page. */
  notFound: string;
  open: string;
}
export const metadata: Record<Locale, PageMetadata> = {
  en: {
    title: 'GlobeHops – your journey on a 3D globe',
    description:
      'Enter airports and see your journey by air as true great-circle routes on an interactive 3D globe, with distances and estimated flight times.',
    socialDescription:
      'See any journey by air as it really curves around the Earth: great-circle routes, distances and estimated flight times.',
    imageAlt: 'A 3D globe showing a flight route from Copenhagen via London to New York.',
    noscript: 'GlobeHops needs JavaScript to show your journey on the globe. Agents can read the',
    guide: 'agent and LLM guide',
    notFound: 'This page does not exist.',
    open: 'Open GlobeHops',
  },
  hu: {
    title: 'GlobeHops – az utad egy 3D-s földgömbön',
    description:
      'Adj meg repülőtereket, és nézd meg a légi útvonalad egy interaktív 3D-s földgömbön, főkörívekkel, távolságokkal és becsült repülési időkkel.',
    socialDescription:
      'Nézd meg, hogyan ível a légi útvonalad a Föld körül: főkörívek, távolságok és becsült repülési idők.',
    imageAlt: '3D-s földgömb egy Koppenhága–London–New York légi útvonallal.',
    noscript:
      'A GlobeHops JavaScriptet igényel az útvonal földgömbön való megjelenítéséhez. Az ügynököknek szóló leírás:',
    guide: 'útmutató ügynököknek és nyelvi modelleknek',
    notFound: 'Ez az oldal nem létezik.',
    open: 'A GlobeHops megnyitása',
  },
  sv: {
    title: 'GlobeHops – din resa på en 3D-jordglob',
    description:
      'Ange flygplatser och se din flygresa som storcirkelrutter på en interaktiv 3D-jordglob, med avstånd och beräknade flygtider.',
    socialDescription:
      'Se hur din flygresa följer jordens krökning: storcirkelrutter, avstånd och beräknade flygtider.',
    imageAlt: 'En 3D-jordglob med en flygrutt från Köpenhamn via London till New York.',
    noscript: 'GlobeHops behöver JavaScript för att visa din resa på jordgloben. Agenter kan läsa',
    guide: 'guiden för agenter och språkmodeller',
    notFound: 'Den här sidan finns inte.',
    open: 'Öppna GlobeHops',
  },
};
