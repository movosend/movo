import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addressesClient,
  type Address,
  type CreateAddressInput,
  type UpdateAddressInput,
} from "../api/addresses-client";

const ADDRESSES_QUERY_KEY = ["addresses", "mine"];

/**
 * Direcciones guardadas del usuario (MOVO-119, contrato propuesto, backend todavía
 * sin implementar al momento de escribir esto). Mientras `/addresses` no exista, esta
 * query falla — los callers (p.ej. el paso de direcciones del wizard) deben tratar
 * `isError`/lista vacía como "sin direcciones guardadas", nunca romper la pantalla.
 */
export function useAddresses() {
  return useQuery({
    queryKey: ADDRESSES_QUERY_KEY,
    queryFn: () => addressesClient.list(),
    retry: false,
  });
}

export function useCreateAddress() {
  const queryClient = useQueryClient();
  return useMutation<Address, unknown, CreateAddressInput>({
    mutationFn: (body) => addressesClient.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADDRESSES_QUERY_KEY });
    },
  });
}

export function useUpdateAddress() {
  const queryClient = useQueryClient();
  return useMutation<Address, unknown, { id: string; body: UpdateAddressInput }>({
    mutationFn: ({ id, body }) => addressesClient.update(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADDRESSES_QUERY_KEY });
    },
  });
}

export function useDeleteAddress() {
  const queryClient = useQueryClient();
  return useMutation<void, unknown, string>({
    mutationFn: (id) => addressesClient.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ADDRESSES_QUERY_KEY });
    },
  });
}
