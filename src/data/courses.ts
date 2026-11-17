/**
 * Free, open courses that concept pages link to under "Learn more". We link out only:
 * several are CC BY-NC-ND, so every word and drawing on our pages stays our own.
 * Kept free of imports so scripts/lint-lessons.ts can load it under plain Node.
 */

export type CourseId = 'primer' | 'karan' | 'bytebytego' | 'scalability' | 'mit' | 'kleppmann';

export interface Course {
  id: CourseId;
  /** Short name used to label "Learn more" links. */
  name: string;
  author: string;
  url: string;
  license: string;
  /** One line for the "Keep learning" list. */
  blurb: string;
  /** Extra entry points, such as a video playlist. */
  links?: { label: string; url: string }[];
}

export const courses: Course[] = [
  {
    id: 'primer',
    name: 'The System Design Primer',
    author: 'Donne Martin',
    url: 'https://github.com/donnemartin/system-design-primer',
    license: 'CC BY 4.0',
    blurb: 'A broad tour of scaling topics, with interview questions and worked designs.',
  },
  {
    id: 'karan',
    name: 'System Design',
    author: 'Karan Pratap Singh',
    url: 'https://github.com/karanpratapsingh/system-design',
    license: 'CC BY-NC-ND 4.0',
    blurb: 'A structured course from networking basics to distributed patterns.',
  },
  {
    id: 'bytebytego',
    name: 'System Design 101',
    author: 'ByteByteGo',
    url: 'https://github.com/ByteByteGoHq/system-design-101',
    license: 'CC BY-NC-ND 4.0',
    blurb: 'Short visual guides to how common systems and protocols work.',
    links: [{ label: 'Visual guides', url: 'https://bytebytego.com/guides/' }],
  },
  {
    id: 'scalability',
    name: 'Awesome Scalability',
    author: 'Binh Nguyen',
    url: 'https://github.com/binhnguyennus/awesome-scalability',
    license: 'MIT',
    blurb: 'A reading list of engineering blog posts on how real companies scale.',
  },
  {
    id: 'mit',
    name: 'MIT 6.5840 Distributed Systems',
    author: 'MIT PDOS',
    url: 'https://pdos.csail.mit.edu/6.824/',
    license: 'Free course materials',
    blurb: 'Lectures, papers and labs where you build a fault-tolerant key-value store.',
  },
  {
    id: 'kleppmann',
    name: 'Distributed Systems lectures',
    author: 'Martin Kleppmann, University of Cambridge',
    url: 'https://www.cl.cam.ac.uk/teaching/2122/ConcDisSys/dist-sys-notes.pdf',
    license: 'CC BY-SA 4.0',
    blurb: 'Notes (PDF) and videos for eight lectures on time, replication, consensus and consistency.',
    links: [
      {
        label: 'Lecture videos',
        url: 'https://www.youtube.com/playlist?list=PLeKd45zvjcDFUEv_ohr_HdUFe97RItdiB',
      },
    ],
  },
];

export function course(id: CourseId): Course {
  const found = courses.find((entry) => entry.id === id);
  if (!found) throw new Error(`unknown course "${id}"`);
  return found;
}
