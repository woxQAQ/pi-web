<script setup lang="ts">
defineProps<{
	visible: boolean;
	reason: string;
	reconnectCount: number;
}>();
</script>

<template>
	<Transition name="banner-slide">
		<div v-if="visible" class="reconnect-banner" role="alert" aria-live="polite">
			<span class="pulse-dot"></span>
			<span class="banner-text">{{ reason || 'Connection lost' }}. Reconnecting...</span>
			<span v-if="reconnectCount > 1" class="attempt-badge">Attempt {{ reconnectCount }}</span>
		</div>
	</Transition>
</template>

<style scoped>
.reconnect-banner {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 6px 16px;
	background: var(--panel);
	border-bottom: 1px solid var(--border);
	color: var(--text-muted);
	font-size: 0.72rem;
	flex-shrink: 0;
	z-index: 19;
}

.pulse-dot {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: var(--text-muted);
	flex-shrink: 0;
	animation: pulse-glow 1.5s ease-in-out infinite;
}

.banner-text {
	flex: 1;
}

.attempt-badge {
	height: 22px;
	padding: 0 8px;
	border-radius: 999px;
	border: 1px solid var(--border-strong);
	background: var(--panel-2);
	color: var(--text-subtle);
	font-size: 0.66rem;
	line-height: 22px;
	white-space: nowrap;
}

@keyframes pulse-glow {
	0%,
	100% {
		opacity: 0.4;
		transform: scale(0.8);
	}
	50% {
		opacity: 1;
		transform: scale(1.05);
	}
}

.banner-slide-enter-active,
.banner-slide-leave-active {
	transition: transform 0.2s ease, opacity 0.2s ease;
}

.banner-slide-enter-from,
.banner-slide-leave-to {
	transform: translateY(-100%);
	opacity: 0;
}
</style>
