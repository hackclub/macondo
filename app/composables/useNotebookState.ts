// Module scope so every caller shares one state; read by the open_notebook tutorial challenge.
const hasBeenOpened = ref(false);

export function useNotebookState() {
  return {
    hasBeenOpened,
    markOpened() {
      hasBeenOpened.value = true;
    },
  };
}
