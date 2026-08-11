import torch
import torch.nn as nn
import torch.nn.functional as F

class SimpleLSTM(nn.Module):
    def __init__(self, input_size, hidden_size=64, num_layers=2, output_size=1):
        super(SimpleLSTM, self).__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.lstm = nn.LSTM(input_size, hidden_size, num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_size, output_size)
        
    def forward(self, x):
        if len(x.shape) == 2:
            x = x.unsqueeze(1)
        h0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(x.device)
        c0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(x.device)
        out, _ = self.lstm(x, (h0, c0))
        out = self.fc(out[:, -1, :])
        return out

class SimpleGRU(nn.Module):
    def __init__(self, input_size, hidden_size=64, num_layers=2, output_size=1):
        super(SimpleGRU, self).__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.gru = nn.GRU(input_size, hidden_size, num_layers, batch_first=True)
        self.fc = nn.Linear(hidden_size, output_size)
        
    def forward(self, x):
        # x expected shape: (batch, seq, features) or (batch, features)
        if len(x.shape) == 2:
            x = x.unsqueeze(1)
            
        h0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size).to(x.device)
        out, _ = self.gru(x, h0)
        # Take the output of the last time step
        out = self.fc(out[:, -1, :])
        return out

class CNN1D(nn.Module):
    def __init__(self, input_size, output_size=1):
        super(CNN1D, self).__init__()
        self.conv1 = nn.Conv1d(in_channels=1, out_channels=32, kernel_size=3, padding=1)
        self.pool = nn.MaxPool1d(kernel_size=2)
        self.conv2 = nn.Conv1d(in_channels=32, out_channels=64, kernel_size=3, padding=1)
        
        # Calculate size after convolutions and pooling
        # Using a dummy tensor to determine the flattened size
        dummy = torch.zeros(1, 1, input_size)
        dummy = self.pool(F.relu(self.conv1(dummy)))
        dummy = self.pool(F.relu(self.conv2(dummy)))
        flattened_size = dummy.view(-1).size(0)
        
        self.fc1 = nn.Linear(flattened_size, 64)
        self.fc2 = nn.Linear(64, output_size)
        
    def forward(self, x):
        # x expected shape: (batch, features)
        if len(x.shape) == 3:
            # Flatten seq if provided
            x = x.view(x.size(0), -1)
            
        x = x.unsqueeze(1) # Add channel dim
        x = self.pool(F.relu(self.conv1(x)))
        x = self.pool(F.relu(self.conv2(x)))
        x = x.view(x.size(0), -1)
        x = F.relu(self.fc1(x))
        out = self.fc2(x)
        return out

class DeepLOB(nn.Module):
    def __init__(self, input_size, output_size=1):
        super(DeepLOB, self).__init__()
        self.conv1 = nn.Conv1d(in_channels=1, out_channels=16, kernel_size=3, padding=1)
        self.conv2 = nn.Conv1d(in_channels=16, out_channels=32, kernel_size=3, padding=1)
        
        # Calculate size after convolutions
        dummy = torch.zeros(1, 1, input_size)
        dummy = F.leaky_relu(self.conv1(dummy))
        dummy = F.leaky_relu(self.conv2(dummy))
        conv_out_size = dummy.view(-1).size(0)
        
        self.lstm = nn.LSTM(input_size=conv_out_size, hidden_size=64, num_layers=1, batch_first=True)
        self.fc = nn.Linear(64, output_size)
        
    def forward(self, x):
        if len(x.shape) == 3:
            x = x.view(x.size(0), -1)
            
        x = x.unsqueeze(1)
        x = F.leaky_relu(self.conv1(x))
        x = F.leaky_relu(self.conv2(x))
        x = x.view(x.size(0), 1, -1)
        out, _ = self.lstm(x)
        out = self.fc(out[:, -1, :])
        return out

class TCN(nn.Module):
    def __init__(self, input_size, output_size=1):
        super(TCN, self).__init__()
        self.conv1 = nn.Conv1d(in_channels=1, out_channels=32, kernel_size=3, padding=2, dilation=2)
        self.conv2 = nn.Conv1d(in_channels=32, out_channels=64, kernel_size=3, padding=4, dilation=4)
        
        dummy = torch.zeros(1, 1, input_size)
        dummy = F.relu(self.conv1(dummy))
        dummy = F.relu(self.conv2(dummy))
        flattened_size = dummy.view(-1).size(0)
        
        self.fc = nn.Linear(flattened_size, output_size)
        
    def forward(self, x):
        if len(x.shape) == 3:
            x = x.view(x.size(0), -1)
        
        x = x.unsqueeze(1)
        x = F.relu(self.conv1(x))
        x = F.relu(self.conv2(x))
        x = x.view(x.size(0), -1)
        out = self.fc(x)
        return out

class StandardTransformer(nn.Module):
    def __init__(self, input_size, output_size=1, d_model=64, nhead=4, num_layers=2):
        super(StandardTransformer, self).__init__()
        self.input_proj = nn.Linear(input_size, d_model)
        encoder_layer = nn.TransformerEncoderLayer(d_model=d_model, nhead=nhead, batch_first=True)
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.fc = nn.Linear(d_model, output_size)
        
    def forward(self, x):
        if len(x.shape) == 2:
            x = x.unsqueeze(1)
            
        x = self.input_proj(x)
        x = self.transformer(x)
        
        # Take the mean over the sequence dimension
        out = torch.mean(x, dim=1)
        out = self.fc(out)
        return out
