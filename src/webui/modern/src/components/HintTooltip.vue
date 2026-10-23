<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';

const props = defineProps<{ text: string; label: string }>();
const id = useId();
const trigger = ref<HTMLButtonElement | null>(null);
const tip = ref<HTMLElement | null>(null);
const host = ref<HTMLElement | string>('body');
const open = ref(false);
const positioned = ref(false);
const left = ref(0);
const top = ref(0);
const nativePopover = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;
let hovered = false;
let focused = false;
let timer: ReturnType<typeof setTimeout> | undefined;

const position = () => {
    if (!open.value || !trigger.value || !tip.value) return;
    const anchor = trigger.value.getBoundingClientRect();
    const box = tip.value.getBoundingClientRect();
    left.value = Math.max(12, Math.min(anchor.left, innerWidth - box.width - 12));
    top.value = Math.max(12, anchor.bottom + box.height + 20 <= innerHeight
        ? anchor.bottom + 8 : anchor.top - box.height - 8);
    positioned.value = true;
};
const show = async () => {
    clearTimeout(timer);
    if (!props.text) return;
    open.value = true;
    await nextTick();
    if (!open.value || !tip.value?.isConnected) return;
    if (nativePopover && !tip.value.matches(':popover-open')) tip.value.showPopover();
    position();
};
const hide = () => {
    clearTimeout(timer);
    if (nativePopover && tip.value?.matches(':popover-open')) tip.value.hidePopover();
    open.value = false;
    positioned.value = false;
};
const leave = () => {
    if (!hovered && !focused) timer = setTimeout(hide, 120);
};
const enter = () => { hovered = true; void show(); };
const exit = () => { hovered = false; leave(); };
const focus = () => { focused = true; void show(); };
const blur = () => { focused = false; leave(); };
const outside = (event: PointerEvent) => {
    if (!trigger.value?.contains(event.target as Node) && !tip.value?.contains(event.target as Node)) hide();
};
const keydown = (event: KeyboardEvent) => {
    if (open.value && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        hide();
    }
};
onMounted(() => {
    // Stay inside the dialog DOM to avoid its inert backdrop. Native popovers
    // join the top layer and escape clipping by the dialog or a scroll panel.
    host.value = trigger.value?.closest('dialog') || document.body;
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keydown, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
});
onBeforeUnmount(() => {
    hide();
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('keydown', keydown, true);
    window.removeEventListener('scroll', hide, true);
    window.removeEventListener('resize', hide);
});
watch(() => props.text, async () => {
    if (!props.text) hide();
    else if (open.value) { await nextTick(); position(); }
});
</script>

<template>
    <span class="hint-host">
        <button ref="trigger" type="button" class="hint-trigger" :aria-label="label" :aria-describedby="open ? id : undefined" @pointerenter="enter" @pointerleave="exit" @focus="focus" @blur="blur" @click.stop.prevent="show"><slot /></button>
        <Teleport :to="host">
            <span v-show="open" :id="id" ref="tip" class="hint-tooltip" role="tooltip" :popover="nativePopover ? 'manual' : undefined" :style="{ left: `${left}px`, top: `${top}px`, visibility: positioned ? 'visible' : 'hidden' }" @pointerenter="enter" @pointerleave="exit">{{ text }}</span>
        </Teleport>
    </span>
</template>

<style scoped>
.hint-host { display: inline-flex; width: fit-content; max-width: 100%; }
.hint-trigger { display: inline-flex; align-items: center; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.hint-tooltip { position: fixed; inset: auto; z-index: 1000; width: max-content; max-width: min(300px, calc(100vw - 24px)); margin: 0; padding: 8px 10px; border: 1px solid var(--border-input); border-radius: 4px; background: var(--surface-overlay); color: var(--text); font-family: inherit; font-size: 12px; font-weight: 400; line-height: 1.6; overflow-wrap: anywhere; box-shadow: 0 3px 12px rgb(0 0 0 / 18%); }
</style>
