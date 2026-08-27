from collections import defaultdict

from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.utils import timezone


ROOM_STATE = defaultdict(lambda: {'participants': {}, 'chat': []})


class ConferenceRoomConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope['user']
        if not user.is_authenticated:
            await self.close(code=4001)
            return

        self.conference_id = self.scope['url_route']['kwargs']['conference_id']
        self.room_group_name = f'conference_room_{self.conference_id}'
        self.participant_id = self.channel_name
        self.display_name = user.get_full_name() or user.username

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        room_state = ROOM_STATE[self.room_group_name]
        room_state['participants'][self.participant_id] = {
            'id': self.participant_id,
            'user_id': user.id,
            'username': user.username,
            'name': self.display_name,
        }

        await self.accept()

        await self.send_json(
            {
                'type': 'room.initial_state',
                'self': room_state['participants'][self.participant_id],
                'participants': [
                    participant
                    for participant_id, participant in room_state['participants'].items()
                    if participant_id != self.participant_id
                ],
                'chat': room_state['chat'][-50:],
            }
        )

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'participant_joined',
                'participant': room_state['participants'][self.participant_id],
            },
        )

    async def disconnect(self, close_code):
        room_state = ROOM_STATE.get(self.room_group_name)
        if room_state:
            participant = room_state['participants'].pop(self.participant_id, None)
            if participant:
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'participant_left',
                        'participant_id': self.participant_id,
                    },
                )
            if not room_state['participants']:
                ROOM_STATE.pop(self.room_group_name, None)

        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        message_type = content.get('type')

        if message_type == 'signal':
            await self._relay_signal(content)
        elif message_type == 'chat.message':
            await self._broadcast_chat(content)
        elif message_type == 'room.sync':
            await self._sync_room_state()

    async def _relay_signal(self, content):
        target = content.get('to')
        if not target:
            return

        payload = {
            'type': 'signal.message',
            'from': self.participant_id,
            'signal_type': content.get('signal_type'),
            'data': content.get('data'),
        }
        await self.channel_layer.send(target, payload)

    async def _broadcast_chat(self, content):
        room_state = ROOM_STATE[self.room_group_name]
        chat_message = {
            'id': f'{self.participant_id}:{len(room_state["chat"])}',
            'participant_id': self.participant_id,
            'name': self.display_name,
            'message': (content.get('message') or '').strip(),
            'timestamp': timezone.now().isoformat(),
        }
        if not chat_message['message']:
            return

        room_state['chat'].append(chat_message)
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat.message',
                'message': chat_message,
            },
        )

    async def _sync_room_state(self):
        room_state = ROOM_STATE[self.room_group_name]
        await self.send_json(
            {
                'type': 'room.initial_state',
                'self': room_state['participants'].get(self.participant_id),
                'participants': [
                    participant
                    for participant_id, participant in room_state['participants'].items()
                    if participant_id != self.participant_id
                ],
                'chat': room_state['chat'][-50:],
            }
        )

    async def signal_message(self, event):
        await self.send_json(
            {
                'type': 'signal.message',
                'from': event['from'],
                'signal_type': event['signal_type'],
                'data': event['data'],
            }
        )

    async def participant_joined(self, event):
        await self.send_json(
            {
                'type': 'participant.joined',
                'participant': event['participant'],
            }
        )

    async def participant_left(self, event):
        await self.send_json(
            {
                'type': 'participant.left',
                'participant_id': event['participant_id'],
            }
        )

    async def chat_message(self, event):
        await self.send_json(
            {
                'type': 'chat.message',
                'message': event['message'],
            }
        )
