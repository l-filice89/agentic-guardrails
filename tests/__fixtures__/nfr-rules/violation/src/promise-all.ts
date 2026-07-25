// Promise.all over a .map result is dynamically sized: unbounded fan-out.
export async function fanOut(urls: string[]): Promise<number[]> {
  return Promise.all(urls.map(async (u) => u.length));
}
