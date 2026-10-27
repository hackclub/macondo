// Replaces window.alert/confirm/prompt with a WoodFrame modal rendered once at the root

export type AlertTone = "info" | "error" | "success" | "warning";
export type AlertMode = "alert" | "confirm" | "prompt";

export interface AlertOptions {
  title?: string;
  message: string;
  tone?: AlertTone;
  okLabel?: string;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  tone?: AlertTone;
  confirmLabel?: string;
  cancelLabel?: string;
  // Red confirm button, for cancel/delete flows
  destructive?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
}

interface AlertState {
  visible: boolean;
  mode: AlertMode;
  title: string;
  message: string;
  tone: AlertTone;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
  inputValue: string;
  placeholder: string;
  required: boolean;
  // Payload depends on mode, so widened to unknown and cast back in each helper
  resolve: ((value: unknown) => void) | null;
}

function defaultState(): AlertState {
  return {
    visible: false,
    mode: "alert",
    title: "",
    message: "",
    tone: "info",
    confirmLabel: "OK",
    cancelLabel: "Cancel",
    destructive: false,
    inputValue: "",
    placeholder: "",
    required: false,
    resolve: null,
  };
}

export const useAlertDialog = () => {
  const state = useState<AlertState>("alert_dialog_state", defaultState);
  const { t } = useI18n();

  function showAlert(opts: AlertOptions | string): Promise<void> {
    const norm: AlertOptions = typeof opts === "string" ? { message: opts } : opts;
    return new Promise<void>((resolve) => {
      Object.assign(state.value, defaultState());
      state.value.mode = "alert";
      state.value.tone = norm.tone ?? "info";
      state.value.title = norm.title ?? defaultTitleForTone(state.value.tone, t);
      state.value.message = norm.message;
      state.value.confirmLabel = norm.okLabel ?? t("alert.ok");
      state.value.resolve = resolve as (value: unknown) => void;
      state.value.visible = true;
    });
  }

  function showConfirm(opts: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      Object.assign(state.value, defaultState());
      state.value.mode = "confirm";
      state.value.tone = opts.tone ?? "warning";
      state.value.title = opts.title ?? defaultTitleForTone(state.value.tone, t);
      state.value.message = opts.message;
      state.value.confirmLabel = opts.confirmLabel ?? t("common.confirm");
      state.value.cancelLabel = opts.cancelLabel ?? t("common.cancel");
      state.value.destructive = opts.destructive === true;
      state.value.resolve = resolve as (value: unknown) => void;
      state.value.visible = true;
    });
  }

  function showPrompt(opts: PromptOptions): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      Object.assign(state.value, defaultState());
      state.value.mode = "prompt";
      state.value.tone = opts.tone ?? "info";
      state.value.title = opts.title ?? defaultTitleForTone(state.value.tone, t);
      state.value.message = opts.message;
      state.value.confirmLabel = opts.confirmLabel ?? t("common.submit");
      state.value.cancelLabel = opts.cancelLabel ?? t("common.cancel");
      state.value.destructive = opts.destructive === true;
      state.value.placeholder = opts.placeholder ?? "";
      state.value.required = opts.required === true;
      state.value.inputValue = opts.defaultValue ?? "";
      state.value.resolve = resolve as (value: unknown) => void;
      state.value.visible = true;
    });
  }

  function confirmDialog() {
    if (!state.value.visible) return;
    const resolve = state.value.resolve;
    const mode = state.value.mode;
    const inputValue = state.value.inputValue;
    state.value.visible = false;
    state.value.resolve = null;
    if (!resolve) return;
    switch (mode) {
      case "alert":
        resolve(undefined);
        break;
      case "confirm":
        resolve(true);
        break;
      case "prompt":
        resolve(inputValue);
        break;
    }
  }

  // Called on ESC, outside click or Cancel
  function dismissAlert() {
    if (!state.value.visible) return;
    const resolve = state.value.resolve;
    const mode = state.value.mode;
    state.value.visible = false;
    state.value.resolve = null;
    if (!resolve) return;
    switch (mode) {
      case "alert":
        resolve(undefined);
        break;
      case "confirm":
        resolve(false);
        break;
      case "prompt":
        resolve(null);
        break;
    }
  }

  return { state, showAlert, showConfirm, showPrompt, confirmDialog, dismissAlert };
};

function defaultTitleForTone(tone: AlertTone, t: (key: string) => string): string {
  switch (tone) {
    case "error":
      return t("alert.default_title_error");
    case "success":
      return t("alert.default_title_success");
    case "warning":
      return t("alert.default_title_warning");
    default:
      return t("alert.default_title_info");
  }
}
