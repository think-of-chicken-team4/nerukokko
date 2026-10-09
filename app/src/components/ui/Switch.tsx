"use client";

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** 画面読み上げ用の名前。横に見出しがあっても必ず付ける（例：「夕方の就寝提案」） */
  label: string;
  disabled?: boolean;
};

// ON/OFF スイッチ。見た目は globals.css の .switch
export function Switch({ checked, onCheckedChange, label, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
    />
  );
}
