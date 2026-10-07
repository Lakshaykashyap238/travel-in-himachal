// intl-tel-input 17 ships without TypeScript types.
declare module 'intl-tel-input' {
  interface Iti {
    getNumber(): string;
    isValidNumber(): boolean | null;
    getSelectedCountryData(): { iso2: string; dialCode: string };
    setNumber(n: string): void;
    destroy(): void;
  }
  const intlTelInput: (input: HTMLInputElement, options?: Record<string, unknown>) => Iti;
  export default intlTelInput;
}
