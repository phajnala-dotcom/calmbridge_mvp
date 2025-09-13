import { useEffect, useRef, useCallback } from 'react';
import { Spinner } from '@librechat/client';
import { useParams } from 'react-router-dom';
import { Constants, EModelEndpoint, ContentTypes } from 'librechat-data-provider';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import type { TPreset } from 'librechat-data-provider';
import { useGetConvoIdQuery, useGetStartupConfig, useGetEndpointsQuery } from '~/data-provider';
import { useNewConvo, useAppStartup, useAssistantListMap, useIdChangeEffect } from '~/hooks';
import { getDefaultModelSpec, getModelSpecPreset, logger } from '~/utils';
import { ToolCallsMapProvider } from '~/Providers';
import ChatView from '~/components/Chat/ChatView';
import LiveKitTextBridge, { LiveKitTextBridgeHandle } from '../components/useLiveKitTextBridge';
import { useQueryClient } from '@tanstack/react-query';
import useAuthRedirect from './useAuthRedirect';
import temporaryStore from '~/store/temporary';
import { useRecoilCallback } from 'recoil';
import store from '~/store';

export default function ChatRoute() {
  const { data: startupConfig } = useGetStartupConfig();
  const { isAuthenticated, user } = useAuthRedirect();

  // LiveKit text bridge (headless)
  const livekitRef = useRef<LiveKitTextBridgeHandle>(null);
  const queryClient = useQueryClient();

  const setIsTemporary = useRecoilCallback(
    ({ set }) =>
      (value: boolean) => {
        set(temporaryStore.isTemporary, value);
      },
    [],
  );
  useAppStartup({ startupConfig, user });

  const index = 0;
  const { conversationId = '' } = useParams();
  useIdChangeEffect(conversationId);
  const { hasSetConversation, conversation } = store.useCreateConversationAtom(index);
  const { newConversation } = useNewConvo();

  const createAssistantMessagePayload = useCallback(
    (text: string) => {
      // Bezpečné minimum pre zápis správy; ponecháme endpoint/model z aktuálnej konverzácie
      const messageId = (
        globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
      ).toString();
      return {
        messageId,
        conversationId: conversation?.conversationId,
        parentMessageId: Constants.NO_PARENT,
        sender: 'Assistant',
        isCreatedByUser: false,
        endpoint: conversation?.endpoint,
        model: conversation?.model,
        text,
        content: [
          {
            type: ContentTypes.TEXT,
            text,
          },
        ],
      };
    },
    [conversation],
  );

  const onAgentText = useCallback(
    async (text: string, fromIdentity?: string) => {
      if (!conversation?.conversationId) {
        logger.warn('LiveKit text received but no active conversation found');
        return;
      }
      try {
        const payload = createAssistantMessagePayload(text);
        const res = await fetch(
          `/api/messages/${encodeURIComponent(conversation.conversationId)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        );
        if (!res.ok) {
          throw new Error(`Save message failed: ${res.status}`);
        }
        // Invalidovať cache správ pre aktuálnu konverzáciu, aby ChatView refetchol
        await queryClient.invalidateQueries({
          queryKey: ['messages', conversation?.conversationId],
        });
      } catch (err) {
        logger.error('Failed to save assistant message from LiveKit', err);
      }
    },
    [conversation, createAssistantMessagePayload, queryClient],
  );

  const modelsQuery = useGetModelsQuery({
    enabled: isAuthenticated,
    refetchOnMount: 'always',
  });
  const initialConvoQuery = useGetConvoIdQuery(conversationId, {
    enabled:
      isAuthenticated && conversationId !== Constants.NEW_CONVO && !hasSetConversation.current,
  });
  const endpointsQuery = useGetEndpointsQuery({ enabled: isAuthenticated });
  const assistantListMap = useAssistantListMap();

  const isTemporaryChat = conversation && conversation.expiredAt ? true : false;

  useEffect(() => {
    if (conversationId !== Constants.NEW_CONVO && !isTemporaryChat) {
      setIsTemporary(false);
    } else if (isTemporaryChat) {
      setIsTemporary(isTemporaryChat);
    }
  }, [conversationId, isTemporaryChat, setIsTemporary]);

  /** This effect is mainly for the first conversation state change on first load of the page.
   *  Adjusting this may have unintended consequences on the conversation state.
   */
  useEffect(() => {
    const shouldSetConvo =
      (startupConfig && !hasSetConversation.current && !modelsQuery.data?.initial) ?? false;
    /* Early exit if startupConfig is not loaded and conversation is already set and only initial models have loaded */
    if (!shouldSetConvo) {
      return;
    }

    if (conversationId === Constants.NEW_CONVO && endpointsQuery.data && modelsQuery.data) {
      const spec = getDefaultModelSpec(startupConfig);
      logger.log('conversation', 'ChatRoute, new convo effect', conversation);
      newConversation({
        modelsData: modelsQuery.data,
        template: conversation ? conversation : undefined,
        ...(spec ? { preset: getModelSpecPreset(spec) } : {}),
      });

      hasSetConversation.current = true;
    } else if (initialConvoQuery.data && endpointsQuery.data && modelsQuery.data) {
      logger.log('conversation', 'ChatRoute initialConvoQuery', initialConvoQuery.data);
      newConversation({
        template: initialConvoQuery.data,
        /* this is necessary to load all existing settings */
        preset: initialConvoQuery.data as TPreset,
        modelsData: modelsQuery.data,
        keepLatestMessage: true,
      });
      hasSetConversation.current = true;
    } else if (
      conversationId === Constants.NEW_CONVO &&
      assistantListMap[EModelEndpoint.assistants] &&
      assistantListMap[EModelEndpoint.azureAssistants]
    ) {
      const spec = getDefaultModelSpec(startupConfig);
      logger.log('conversation', 'ChatRoute new convo, assistants effect', conversation);
      newConversation({
        modelsData: modelsQuery.data,
        template: conversation ? conversation : undefined,
        ...(spec ? { preset: getModelSpecPreset(spec) } : {}),
      });
      hasSetConversation.current = true;
    } else if (
      assistantListMap[EModelEndpoint.assistants] &&
      assistantListMap[EModelEndpoint.azureAssistants]
    ) {
      logger.log('conversation', 'ChatRoute convo, assistants effect', initialConvoQuery.data);
      newConversation({
        template: initialConvoQuery.data,
        preset: initialConvoQuery.data as TPreset,
        modelsData: modelsQuery.data,
        keepLatestMessage: true,
      });
      hasSetConversation.current = true;
    }
    /* Creates infinite render if all dependencies included due to newConversation invocations exceeding call stack before hasSetConversation.current becomes truthy */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    startupConfig,
    initialConvoQuery.data,
    endpointsQuery.data,
    modelsQuery.data,
    assistantListMap,
  ]);

  if (endpointsQuery.isLoading || modelsQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center" aria-live="polite" role="status">
        <Spinner className="text-text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  // if not a conversation
  if (conversation?.conversationId === Constants.SEARCH) {
    return null;
  }
  // if conversationId not match
  if (conversation?.conversationId !== conversationId && !conversation) {
    return null;
  }
  // if conversationId is null
  if (!conversationId) {
    return null;
  }

  return (
    <ToolCallsMapProvider conversationId={conversation.conversationId ?? ''}>
      {/* Headless LiveKit text bridge: pripojenie do room a príjem textu cez DataChannel */}
      <LiveKitTextBridge ref={livekitRef} onReceive={onAgentText} />
      <ChatView index={index} />
    </ToolCallsMapProvider>
  );
}