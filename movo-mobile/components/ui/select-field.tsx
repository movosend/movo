import { ChevronDown, Check } from 'lucide-react-native';
import { useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface SelectFieldProps {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  testID?: string;
  containerClassName?: string;
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = 'Seleccioná una opción',
  error,
  testID,
  containerClassName,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);

  return (
    <View className={containerClassName ?? 'mb-3.5 gap-1.5'}>
      <Text className="font-sans-medium text-[12px] text-fg-2">{label}</Text>
      <Pressable
        testID={testID}
        onPress={() => setOpen(true)}
        className="w-full flex-row items-center justify-between rounded-md border border-border-strong px-3.5 py-3"
      >
        <Text
          className={`font-sans text-body ${value ? 'text-ink-950' : 'text-fg-2'}`}
          numberOfLines={1}
        >
          {value || placeholder}
        </Text>
        <ChevronDown size={18} color="#8A8A93" strokeWidth={2} />
      </Pressable>
      {error ? (
        <Text testID={testID ? `${testID}-error` : undefined} className="font-sans text-[12px] text-danger-500">
          {error}
        </Text>
      ) : null}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/40" onPress={() => setOpen(false)}>
          <Pressable className="max-h-[70%] rounded-t-2xl bg-paper" onPress={(e) => e.stopPropagation()}>
            <SafeAreaView edges={['bottom']}>
              <View className="items-center border-b border-border-strong px-5 py-3.5">
                <Text className="font-sans-medium text-[14px] text-ink-950">{label}</Text>
              </View>
              <FlatList
                data={options}
                keyExtractor={(item) => item}
                renderItem={({ item }) => (
                  <Pressable
                    testID={testID ? `${testID}-option-${item}` : undefined}
                    onPress={() => {
                      onChange(item);
                      setOpen(false);
                    }}
                    className="flex-row items-center justify-between px-5 py-3.5"
                  >
                    <Text className="font-sans text-body text-ink-950">{item}</Text>
                    {item === value ? <Check size={18} color="#0A0A0B" strokeWidth={2} /> : null}
                  </Pressable>
                )}
              />
            </SafeAreaView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
