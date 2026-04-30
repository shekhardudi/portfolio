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
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Select
        value={value}
        onValueChange={(email) => {
          const p = personas.find((x) => x.email === email);
          if (p) onChange(p);
        }}
      >
        <SelectTrigger className="h-8 w-56 bg-muted/40 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {personas.map((p) => (
            <SelectItem key={p.email} value={p.email}>
              <div className="flex flex-col">
                <span>{p.full_name}</span>
                <span className="text-[10px] text-muted-foreground">{p.role}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
