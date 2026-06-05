from django.urls import re_path

from . import consumers

websocket_urlpatterns = [
    re_path(
        r'^ws/conference/(?P<conference_id>\d+)/room/$',
        consumers.ConferenceRoomConsumer.as_asgi(),
    ),
]