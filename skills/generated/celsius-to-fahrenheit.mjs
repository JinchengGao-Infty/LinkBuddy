export default async function celsiusToFahrenheit(input: { celsius: number }): Promise<{ celsius: number; fahrenheit: number }> {
  const { celsius } = input;
  const fahrenheit = (celsius * 9 / 5) + 32;
  return { celsius, fahrenheit };
}