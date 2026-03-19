export default async function celsiusToFahrenheit(input) {
  const { celsius } = input;
  const fahrenheit = (celsius * 9 / 5) + 32;
  return { celsius, fahrenheit };
}
