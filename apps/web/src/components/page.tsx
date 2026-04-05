'use client';

import ChatImageUploader from '@/components/ChatImageUploader';
import MessagesList from '@/components/MessagesList';

export default function ChatPage({ params }: { params: { orderId: string } }) {
  const { orderId } = params;
  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Chat commande #{orderId}</h1>

      {/* Uploader d’images */}
      <ChatImageUploader orderId={orderId} />

      {/* Liste des messages avec affichage image (URL signée) */}
      <MessagesList orderId={orderId} />
    </main>
  );
}


