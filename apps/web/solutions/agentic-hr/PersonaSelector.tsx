'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Persona } from './personas';

interface Props {
  personas: Persona[];
  value: string; // email
  onChange: (p: Persona) => void;
  label?: string;
}

export default function PersonaSelector({ personas, value, onChange, label = 'Persona' }: Props) {
  const selectedPersona = personas.find((p) => p.email === value);

  return (
    <label className="flex items-center gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/55">
        {label}
      </span>
      <Select
        value={value}
        onValueChange={(email) => {
          const p = personas.find((x) => x.email === email);
          if (p) onChange(p);
        }}
      >
        <SelectTrigger className="h-10 w-60 bg-background/70 px-3 py-2 text-sm font-medium leading-5">
          <SelectValue>{selectedPersona?.full_name}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {personas.map((p) => (
            <SelectItem key={p.email} value={p.email} textValue={p.full_name} className="items-start py-2">
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-medium">{p.full_name}</span>
                <span className="mt-0.5 text-[11px] text-muted-foreground">{p.role}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
