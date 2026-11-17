import type { QuizQuestion } from '../lesson/Quiz';

/** Joins each number to the word after it with a no-break space, so "250 ms" never wraps between the two. */
export function keepNumbersWithWords(text: string): string {
  return text.replace(/(\d) +(?=\S)/g, '$1\u00a0');
}

/** Applies `keepNumbersWithWords` to a concept quiz's prompts, options and feedback. */
export function keepQuizNumbersWithWords(questions: readonly QuizQuestion[]): QuizQuestion[] {
  return questions.map((question) => ({
    ...question,
    prompt: keepNumbersWithWords(question.prompt),
    options: question.options.map((option) => ({
      ...option,
      text: keepNumbersWithWords(option.text),
      why: keepNumbersWithWords(option.why),
    })),
  }));
}
