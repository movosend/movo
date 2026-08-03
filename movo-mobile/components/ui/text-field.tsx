import { forwardRef, type ReactNode } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string;
  testID?: string;
  containerClassName?: string;
  rightElement?: ReactNode;
  leftElement?: ReactNode;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, testID, containerClassName, rightElement, leftElement, ...inputProps },
  ref,
) {
  return (
    <View className={containerClassName ?? 'mb-3.5 gap-1.5'}>
      <Text className="font-sans-medium text-[12px] text-fg-2">{label}</Text>
      <View className="relative justify-center">
        <TextInput
          ref={ref}
          testID={testID}
          placeholderTextColor="#8A8A93"
          className={`w-full rounded-md border border-border-strong py-3 font-sans text-[15px] text-ink-950 ${
            rightElement ? 'pr-11' : 'pr-3.5'
          } ${leftElement ? 'pl-[78px]' : 'pl-3.5'}`}
          textAlignVertical="center"
          {...inputProps}
          style={[{ includeFontPadding: false }, inputProps.style]}
        />
        {leftElement ? <View className="pointer-events-none absolute left-3.5">{leftElement}</View> : null}
        {rightElement ? <View className="absolute right-2">{rightElement}</View> : null}
      </View>
      {error ? (
        <Text testID={testID ? `${testID}-error` : undefined} className="font-sans text-[12px] text-danger-500">
          {error}
        </Text>
      ) : null}
    </View>
  );
});
